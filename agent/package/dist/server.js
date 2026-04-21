#!/usr/bin/env node
import "./redirection.js";
import "dotenv/config";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, ListResourcesRequestSchema, ReadResourceRequestSchema, ListPromptsRequestSchema, GetPromptRequestSchema, } from "@modelcontextprotocol/sdk/types.js";
import { ZodError, z } from "zod";
// Tools & Modules
import * as baseTools from "./tools/index.js";
import * as baseResources from "./resources/index.js";
import * as basePrompts from "./prompts/index.js";
import { logger } from "./utils/logger.js";
import { MCPError, ErrorCode } from "./utils/errors.js";
import { extractErrorMessage, isMeaningfulErrorMessage } from "./utils/errorMessage.js";
// --- Process Logic Protection ---
// Catch unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection at:', promise);
    logger.error('Reason:', reason);
});
// Catch uncaught exceptions
process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception thrown:', error);
    process.exit(1);
});
// Graceful shutdown on signals
const shutdown = () => {
    logger.info("Termination signal received. Shutting down...");
    process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
// ─── 注册表 ───
const allTools = Object.values(baseTools);
const allResources = Object.values(baseResources);
const allPrompts = Object.values(basePrompts);
function safeJsonStringify(value) {
    return JSON.stringify(value, (_, item) => (typeof item === "bigint" ? item.toString() : item), 2);
}
function inferToolErrorCode(message) {
    const lower = message.toLowerCase();
    if (lower.includes("required") || lower.includes("invalid") || lower.includes("must be") || lower.includes("unexpected") || lower.includes("unrecognized") || lower.includes("zero address")) {
        return "INVALID_PARAM";
    }
    if (lower.includes("insufficient") && (lower.includes("allowance") || lower.includes("approval"))) {
        return "INSUFFICIENT_ALLOWANCE";
    }
    if (lower.includes("insufficient") || lower.includes("not enough balance") || lower.includes("insufficientbalance")) {
        return "INSUFFICIENT_BALANCE";
    }
    if (lower.includes("not found") || lower.includes("unknown tool")) {
        return "NOT_FOUND";
    }
    if (lower.includes("timeout") || lower.includes("not confirmed")) {
        return "TIMEOUT";
    }
    if (lower.includes("network") || lower.includes("rpc")) {
        return "NETWORK_ERROR";
    }
    if (lower.includes("order size out of range") || lower.includes("minordersize")) {
        return "ORDER_SIZE_TOO_SMALL";
    }
    if (lower.includes("marketid missing") || lower.includes("could not find pool metadata")) {
        return "POOL_NOT_FOUND";
    }
    return "TOOL_EXECUTION_ERROR";
}
function defaultHintForErrorCode(code, toolName) {
    if (code === "INVALID_PARAM") {
        return `Check required fields/types for "${toolName}" and retry.`;
    }
    if (code === "INSUFFICIENT_ALLOWANCE") {
        return `Run "check_approval" before retrying "${toolName}".`;
    }
    if (code === "INSUFFICIENT_BALANCE") {
        return "Top up wallet/trading-account balance or reduce order size.";
    }
    if (code === "NOT_FOUND") {
        return "Verify identifiers (poolId/orderId/marketId) and retry.";
    }
    if (code === "TIMEOUT") {
        return "Query order/position status first, then retry only if needed.";
    }
    if (code === "NETWORK_ERROR") {
        return "Check RPC/network health and retry.";
    }
    if (code === "ORDER_SIZE_TOO_SMALL") {
        return "Increase collateralAmount or leverage to meet the minimum order size requirement.";
    }
    if (code === "POOL_NOT_FOUND") {
        return "The pool ID seems invalid or not supported. Use 'find_pool' or 'list_pools' to find the correct Pool ID.";
    }
    return `Check prerequisites for "${toolName}" and retry.`;
}
function errorResult(payload) {
    const body = {
        status: "error",
        error: {
            tool: payload.tool,
            code: payload.code,
            message: payload.message,
            hint: payload.hint,
            action: payload.action,
            details: payload.details,
        },
    };
    return {
        content: [{ type: "text", text: safeJsonStringify(body) }],
        isError: true,
    };
}
function parseFirstText(result) {
    if (!result || !Array.isArray(result.content))
        return null;
    const firstText = result.content.find((item) => item?.type === "text" && typeof item.text === "string");
    return firstText?.text ?? null;
}
function unwrapSchema(schema) {
    let current = schema;
    for (let i = 0; i < 8; i++) {
        const type = current?._def?.type;
        if (!type)
            break;
        if (type === "optional" || type === "nullable" || type === "default" || type === "prefault" || type === "catch") {
            current = current?._def?.innerType;
            continue;
        }
        if (type === "pipe") {
            current = current?._def?.out;
            continue;
        }
        break;
    }
    return current;
}
function coerceBooleanString(input) {
    if (typeof input !== "string")
        return input;
    const normalized = input.trim().toLowerCase();
    if (normalized === "true" || normalized === "1")
        return true;
    if (normalized === "false" || normalized === "0")
        return false;
    return input;
}
function coerceStringToStringArray(input) {
    if (Array.isArray(input))
        return input.map((item) => String(item).trim()).filter(Boolean);
    if (typeof input !== "string")
        return input;
    const text = input.trim();
    if (!text)
        return input;
    if (text.startsWith("[") && text.endsWith("]")) {
        try {
            const parsed = JSON.parse(text);
            if (Array.isArray(parsed)) {
                return parsed.map((item) => String(item).trim()).filter(Boolean);
            }
        }
        catch {
        }
    }
    if (text.includes(",")) {
        const split = text.split(",").map((item) => item.trim()).filter(Boolean);
        if (split.length > 0)
            return split;
    }
    return input;
}
function coerceEnumString(input, values) {
    if (typeof input !== "string")
        return input;
    const normalizedInput = input.trim().toLowerCase();
    if (!normalizedInput)
        return input;
    const stringValues = values.filter((value) => typeof value === "string");
    const matched = stringValues.find((value) => value.toLowerCase() === normalizedInput);
    return matched ?? input;
}
function normalizeCommonStringAlias(key, input) {
    if (typeof input !== "string")
        return input;
    const normalizedInput = input.trim().toLowerCase();
    if (!normalizedInput)
        return input;
    const aliasMap = {
        status: {
            open: "OPEN",
            history: "HISTORY",
            all: "ALL",
        },
        poolType: {
            base: "BASE",
            quote: "QUOTE",
        },
        direction: {
            buy: "LONG",
            long: "LONG",
            bull: "LONG",
            sell: "SHORT",
            short: "SHORT",
            bear: "SHORT",
        },
        action: {
            add: "deposit",
            increase: "deposit",
            deposit: "deposit",
            remove: "withdraw",
            decrease: "withdraw",
            withdraw: "withdraw",
        },
        orderType: {
            market: "MARKET",
            limit: "LIMIT",
            stop: "STOP",
            conditional: "CONDITIONAL",
        },
        triggerType: {
            none: "NONE",
            gte: "GTE",
            lte: "LTE",
        },
        priceType: {
            market: "market",
            oracle: "oracle",
        },
    };
    return aliasMap[key]?.[normalizedInput] ?? input;
}
function readEnumValues(schema) {
    if (!schema?._def)
        return [];
    const entries = schema._def.entries;
    if (entries && typeof entries === "object") {
        return Object.values(entries);
    }
    const values = schema._def.values;
    if (Array.isArray(values)) {
        return values;
    }
    return [];
}
function coerceBySchema(value, schema) {
    const unwrapped = unwrapSchema(schema);
    const type = unwrapped?._def?.type;
    if (type === "enum") {
        return coerceEnumString(value, readEnumValues(unwrapped));
    }
    if (type === "nativeEnum") {
        return coerceEnumString(value, Object.values(unwrapped?._def?.values ?? {}));
    }
    if (type === "boolean") {
        return coerceBooleanString(value);
    }
    if (type === "array") {
        const elementType = unwrapSchema(unwrapped?._def?.element)?._def?.type;
        if (elementType === "string") {
            return coerceStringToStringArray(value);
        }
    }
    if (type === "union") {
        const options = Array.isArray(unwrapped?._def?.options) ? unwrapped._def.options : [];
        for (const option of options) {
            const unwrappedOption = unwrapSchema(option);
            const optionType = unwrappedOption?._def?.type;
            if (optionType === "enum") {
                const coerced = coerceEnumString(value, readEnumValues(unwrappedOption));
                if (typeof coerced === "string" && coerced !== value)
                    return coerced;
            }
            if (optionType === "nativeEnum") {
                const coerced = coerceEnumString(value, Object.values(unwrappedOption?._def?.values ?? {}));
                if (typeof coerced === "string" && coerced !== value)
                    return coerced;
            }
            if (optionType === "boolean") {
                const coerced = coerceBooleanString(value);
                if (typeof coerced === "boolean")
                    return coerced;
            }
            if (optionType === "array") {
                const coerced = coerceStringToStringArray(value);
                if (Array.isArray(coerced))
                    return coerced;
            }
        }
    }
    return value;
}
function normalizeToolArgsBySchema(rawArgs, schema) {
    const source = rawArgs && typeof rawArgs === "object" ? { ...rawArgs } : {};
    const normalized = {};
    for (const key of Object.keys(source)) {
        normalized[key] = source[key];
    }
    for (const [key, fieldSchema] of Object.entries(schema)) {
        if (!Object.prototype.hasOwnProperty.call(source, key))
            continue;
        const aliasedValue = normalizeCommonStringAlias(key, source[key]);
        normalized[key] = coerceBySchema(aliasedValue, fieldSchema);
    }
    return normalized;
}
function normalizeToolErrorResult(toolName, result) {
    const rawText = parseFirstText(result);
    if (!rawText) {
        return errorResult({
            tool: toolName,
            code: "TOOL_EXECUTION_ERROR",
            message: `Tool "${toolName}" returned an empty error.`,
            hint: defaultHintForErrorCode("TOOL_EXECUTION_ERROR", toolName),
            action: "Inspect server logs for details.",
        });
    }
    let parsed = null;
    try {
        parsed = JSON.parse(rawText);
    }
    catch {
        parsed = null;
    }
    if (parsed &&
        parsed.status === "error" &&
        parsed.error &&
        typeof parsed.error.code === "string" &&
        isMeaningfulErrorMessage(parsed.error.message)) {
        return result;
    }
    const plainMessage = extractErrorMessage(typeof parsed?.error?.message === "string"
        ? parsed.error.message
        : typeof parsed?.message === "string"
            ? parsed.message
            : rawText.replace(/^Error:\s*/i, "").trim(), `Tool "${toolName}" failed.`);
    const code = typeof parsed?.error?.code === "string"
        ? parsed.error.code
        : inferToolErrorCode(plainMessage);
    return errorResult({
        tool: toolName,
        code,
        message: plainMessage,
        hint: defaultHintForErrorCode(code, toolName),
        action: "Adjust parameters/prerequisites and retry.",
    });
}
function validationErrorResult(toolName, error) {
    const issues = error.issues.map((issue) => {
        const pathValue = issue.path.length > 0 ? issue.path.map(String).join(".") : "input";
        return {
            field: pathValue,
            code: issue.code,
            message: issue.message,
        };
    });
    const firstIssue = issues[0];
    const firstHint = firstIssue
        ? `Fix "${firstIssue.field}": ${firstIssue.message}`
        : `Check input schema for "${toolName}".`;
    return errorResult({
        tool: toolName,
        code: "INVALID_PARAM",
        message: `Invalid arguments for tool "${toolName}".`,
        hint: firstHint,
        action: "Call list_tools and resend valid arguments.",
        details: { issues },
    });
}
function normalizeSdkReadFailure(toolName, result) {
    const rawText = parseFirstText(result);
    if (!rawText)
        return result;
    let parsed = null;
    try {
        parsed = JSON.parse(rawText);
    }
    catch {
        return result;
    }
    if (!parsed || parsed.status !== "success")
        return result;
    const data = parsed.data;
    const hasCode = !!data && typeof data === "object" && !Array.isArray(data) && Object.prototype.hasOwnProperty.call(data, "code");
    if (!hasCode)
        return result;
    const code = Number(data.code);
    if (!Number.isFinite(code) || code === 0)
        return result;
    const sdkPayload = data.data;
    const hasPayload = sdkPayload !== null &&
        sdkPayload !== undefined &&
        (!Array.isArray(sdkPayload) || sdkPayload.length > 0);
    if (code > 0 && hasPayload) {
        // Some SDK APIs return non-zero positive codes with usable payloads.
        return result;
    }
    const sdkMessage = String(data.msg ?? data.message ?? `SDK read failed with code=${code}.`);
    return errorResult({
        tool: toolName,
        code: "SDK_READ_ERROR",
        message: `${toolName} failed: code=${code}, msg=${sdkMessage}`,
        hint: "Check chain/account context and required params, then retry.",
        action: "Retry or call prerequisite tools to refresh context.",
        details: { sdk: data },
    });
}
// 将 Zod schema 转换为 JSON Schema (tool listing 用)
function zodSchemaToJsonSchema(zodSchema) {
    const toPropSchema = (value) => {
        const def = value?._def;
        const zodType = def?.type;
        if (zodType === "optional" || zodType === "nullable" || zodType === "default" || zodType === "prefault" || zodType === "catch") {
            return toPropSchema(def?.innerType);
        }
        if (zodType === "pipe") {
            return toPropSchema(def?.out);
        }
        if (zodType === "string")
            return { type: "string" };
        if (zodType === "enum") {
            return { type: "string", enum: def?.values || [] };
        }
        if (zodType === "nativeEnum") {
            return { type: "string", enum: Object.values(def?.values || {}) };
        }
        if (zodType === "number")
            return { type: "number" };
        if (zodType === "boolean")
            return { type: "boolean" };
        if (zodType === "array") {
            return { type: "array", items: toPropSchema(def?.element) };
        }
        if (zodType === "literal") {
            return { const: def?.value };
        }
        if (zodType === "union") {
            const options = def?.options || [];
            return { anyOf: options.map((opt) => toPropSchema(opt)) };
        }
        if (zodType === "object") {
            return { type: "object" };
        }
        return { type: "string" };
    };
    const properties = {};
    const required = [];
    for (const [key, value] of Object.entries(zodSchema)) {
        const desc = value?._def?.description || "";
        const fieldType = value?._def?.type;
        const isOptional = value?.isOptional?.() || fieldType === "optional" || fieldType === "default";
        const prop = toPropSchema(value);
        if (desc)
            prop.description = desc;
        properties[key] = prop;
        if (!isOptional)
            required.push(key);
    }
    return {
        type: "object",
        properties,
        ...(required.length > 0 ? { required } : {}),
    };
}
// ─── MCP Server ───
const server = new Server({ name: "myx-mcp-trading-server", version: "3.1.0" }, { capabilities: { tools: {}, resources: {}, prompts: {} } });
// List tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: allTools.map((t) => ({
            name: t.name,
            description: t.description || t.name,
            inputSchema: zodSchemaToJsonSchema(t.schema),
        })),
    };
});
// Call tools
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const tool = allTools.find((t) => t.name === name);
    if (!tool) {
        return errorResult({
            tool: name,
            code: "NOT_FOUND",
            message: `Unknown tool "${name}".`,
            hint: "Use list_tools to discover available tool names.",
            action: "Retry with a valid tool name.",
        });
    }
    try {
        let validatedArgs = args ?? {};
        if (tool.schema) {
            const normalizedArgs = normalizeToolArgsBySchema(args ?? {}, tool.schema);
            try {
                validatedArgs = z.object(tool.schema).strict().parse(normalizedArgs);
            }
            catch (validationError) {
                if (validationError instanceof ZodError) {
                    return validationErrorResult(name, validationError);
                }
                throw validationError;
            }
        }
        logger.toolExecution(name, validatedArgs);
        const result = await tool.handler(validatedArgs);
        if (result?.isError) {
            return normalizeToolErrorResult(name, result);
        }
        if (result && result.content) {
            return normalizeSdkReadFailure(name, result);
        }
        return {
            content: [{ type: "text", text: safeJsonStringify({ status: "success", data: result }) }],
        };
    }
    catch (error) {
        logger.error(`Error executing tool: ${name}`, error);
        const message = extractErrorMessage(error);
        const code = inferToolErrorCode(message);
        return errorResult({
            tool: name,
            code,
            message,
            hint: defaultHintForErrorCode(code, name),
            action: "Fix inputs/prerequisites and retry.",
        });
    }
});
// Resources Handlers
server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return {
        resources: allResources.map((r) => ({
            uri: r.uri,
            name: r.name,
            mimeType: r.mimetype,
            description: r.description
        }))
    };
});
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const resource = allResources.find((r) => r.uri === request.params.uri);
    if (!resource)
        throw new MCPError(ErrorCode.NOT_FOUND, `Resource ${request.params.uri} not found`);
    try {
        const content = await resource.read();
        return {
            contents: [{
                    uri: request.params.uri,
                    mimeType: resource.mimetype,
                    text: typeof content === 'string' ? content : JSON.stringify(content, null, 2)
                }]
        };
    }
    catch (e) {
        throw new MCPError(ErrorCode.INTERNAL_ERROR, `Failed to read resource: ${e.message}`);
    }
});
// Prompts Handlers
server.setRequestHandler(ListPromptsRequestSchema, async () => {
    return {
        prompts: allPrompts.map((p) => ({
            name: p.name,
            description: p.description,
            arguments: p.arguments
        }))
    };
});
server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const prompt = allPrompts.find((p) => p.name === request.params.name);
    if (!prompt)
        throw new MCPError(ErrorCode.NOT_FOUND, `Prompt ${request.params.name} not found`);
    try {
        const result = await prompt.run(request.params.arguments);
        return {
            description: prompt.description,
            messages: result.messages
        };
    }
    catch (e) {
        throw new MCPError(ErrorCode.INTERNAL_ERROR, `Failed to run prompt: ${e.message}`);
    }
});
// ─── 启动 ───
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    logger.info("🚀 MYX Trading MCP Server v3.1.0 running (stdio, pure on-chain, prod ready)");
}
main().catch((err) => {
    logger.error("Fatal Server Startup Error", err);
    process.exit(1);
});
