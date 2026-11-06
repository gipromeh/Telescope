const endpoint = process.env.YOUGILE_MCP_URL;
const token = process.env.YOUGILE_MCP_TOKEN;

if (!endpoint || !token) {
  console.error("Missing required GitHub Actions secrets: YOUGILE_MCP_URL and/or YOUGILE_MCP_TOKEN.");
  process.exit(1);
}

let target;
try {
  target = new URL(endpoint);
} catch {
  console.error("YOUGILE_MCP_URL is not a valid URL.");
  process.exit(1);
}

if (target.protocol !== "https:") {
  console.error("YOUGILE_MCP_URL must use HTTPS so the Bearer token is sent over TLS.");
  process.exit(1);
}

const timeoutMs = 30_000;
const protocolVersion = "2025-03-26";
let nextId = 1;
let sessionId;
let negotiatedProtocolVersion = protocolVersion;

function safeText(value) {
  return String(value)
    .split(token).join("[REDACTED]")
    .split(endpoint).join("[REDACTED_URL]");
}

async function post(payload, { expectResponse = true } = {}) {
  let response;
  try {
    response = await fetch(target, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}),
        ...(payload.method !== "initialize"
          ? { "MCP-Protocol-Version": negotiatedProtocolVersion }
          : {}),
      },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new Error("MCP request failed (network, TLS, redirect, or timeout).");
  }

  if (response.status === 401 || response.status === 403) {
    throw new Error(`MCP authorization failed (HTTP ${response.status}).`);
  }
  if (!response.ok && response.status !== 202) {
    throw new Error(`MCP request failed (HTTP ${response.status}).`);
  }

  const returnedSession = response.headers.get("mcp-session-id");
  if (returnedSession) sessionId = returnedSession;

  if (!expectResponse || response.status === 202 || response.status === 204) return null;

  let body;
  try {
    body = await response.text();
  } catch {
    throw new Error("Could not read the MCP response.");
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("text/event-stream")) {
    const messages = body
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .filter(Boolean)
      .map(parseJsonSafely)
      .filter(Boolean);
    const match = messages.find((message) => message.id === payload.id);
    if (match) return match;
  } else {
    const parsed = parseJsonSafely(body);
    if (parsed) return parsed;
  }

  throw new Error("MCP response did not contain the expected JSON-RPC reply.");
}

function parseJsonSafely(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function assertReply(reply, id, stage) {
  if (!reply || reply.id !== id) {
    throw new Error(`MCP ${stage} response did not match the request.`);
  }
  if (reply.error) {
    const code = Number.isInteger(reply.error.code) ? reply.error.code : "unknown";
    throw new Error(`MCP ${stage} returned JSON-RPC error code ${code}.`);
  }
  if (!reply.result || typeof reply.result !== "object") {
    throw new Error(`MCP ${stage} response is missing its result.`);
  }
  return reply.result;
}

try {
  const initializeId = nextId++;
  const initialized = assertReply(
    await post({
      jsonrpc: "2.0",
      id: initializeId,
      method: "initialize",
      params: {
        protocolVersion,
        capabilities: {},
        clientInfo: { name: "telescope-yougile-diagnostics", version: "1.0.0" },
      },
    }),
    initializeId,
    "initialize",
  );

  negotiatedProtocolVersion = initialized.protocolVersion ?? protocolVersion;

  await post(
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { expectResponse: false },
  );

  const toolsId = nextId++;
  const toolsReply = assertReply(
    await post({
      jsonrpc: "2.0",
      id: toolsId,
      method: "tools/list",
      params: {},
    }),
    toolsId,
    "tools/list",
  );

  if (!Array.isArray(toolsReply.tools)) {
    throw new Error("MCP tools/list result did not contain a tools array.");
  }

  const tools = toolsReply.tools
    .filter((item) => item && typeof item.name === "string")
    .map((item) => safeText(item.name));

  console.log(`MCP initialized (protocol ${safeText(initialized.protocolVersion ?? protocolVersion)}).`);
  console.log(`Tools reported: ${tools.length}`);
  for (const name of tools) console.log(`- ${name}`);

  // Classify by tool name only; descriptions can cause false positives.
  const knowledgeBase = /knowledge[\s_-]*base|(?:^|[_-])kb(?:[_-]|$)|баз[аы]\s+знан/i;
  const operationPatterns = {
    list: /(?:^|[_-])(list|search|query|find)(?:[_-]|$)|спис|поиск/i,
    create: /(?:^|[_-])(create|add|insert|new)(?:[_-]|$)|созда|добав/i,
    update: /(?:^|[_-])(update|edit|modify|patch|replace)(?:[_-]|$)|обнов|измен|редакт/i,
  };

  console.log("Knowledge Base operations:");
  for (const [operation, pattern] of Object.entries(operationPatterns)) {
    const matches = tools
      .filter((name) => knowledgeBase.test(name))
      .filter((name) => pattern.test(name));
    console.log(`- ${operation}: ${matches.length ? "available" : "not detected"}`);
    for (const name of matches) console.log(`  - ${name}`);
  }

  if (process.env.YOUGILE_MCP_INSPECT_KB === "true") {
    const listTool = toolsReply.tools.find((item) => item?.name === "kb_list_pages");
    if (!listTool) {
      console.log("Read-only KB probe: kb_list_pages tool not found.");
    } else {
      const required = Array.isArray(listTool.inputSchema?.required)
        ? listTool.inputSchema.required
        : [];
      if (required.length > 0) {
        console.log(`Read-only KB probe skipped; required arguments: ${required.join(", ")}.`);
        const properties = listTool.inputSchema?.properties ?? {};
        for (const [name, definition] of Object.entries(properties)) {
          const typeOptions = definition.anyOf ?? definition.oneOf ?? [];
          const types = definition.type ?? typeOptions.map((option) => option.type).filter(Boolean).join("|") || "unspecified";
          const description = definition.description ? safeText(definition.description) : "";
          console.log(`- ${safeText(name)}: type=${safeText(types)}${description ? `; ${description}` : ""}`);
        }
      } else {
        try {
          const probeId = nextId++;
          const probe = assertReply(
            await post({
              jsonrpc: "2.0",
              id: probeId,
              method: "tools/call",
              params: { name: listTool.name, arguments: {} },
            }),
            probeId,
            "read-only KB probe",
          );
          console.log(probe.isError === true
            ? "Read-only KB probe returned an error; response details suppressed."
            : "Read-only KB probe succeeded; response details suppressed.");
        } catch {
          console.log("Read-only KB probe failed; response details suppressed.");
        }
      }
    }
  }

  console.log("Diagnostic is read-only; no YouGile data was changed.");
} catch (error) {
  console.error(safeText(error instanceof Error ? error.message : "Unknown diagnostic failure."));
  process.exitCode = 1;
}
