import { z } from "zod";
import { resolveClient } from "../auth/resolveClient.js";
import { adjustMargin as adjustMarginSvc } from "../services/tradeService.js";
import { finalizeMutationResult } from "../utils/mutationResult.js";
import { extractErrorMessage } from "../utils/errorMessage.js";
export const adjustMarginTool = {
    name: "adjust_margin",
    description: "[TRADE] Adjust the margin (collateral) of an open position.",
    schema: {
        poolId: z.string().describe("Pool ID"),
        positionId: z.string().describe("Position ID"),
        adjustAmount: z.union([z.string(), z.number()]).describe("Adjust amount. Human units are supported (e.g. '1' = 1 USDC). Use 'raw:<int>' for exact raw units."),
        quoteToken: z.string().optional().describe("Quote token address"),
        poolOracleType: z.coerce.number().optional().describe("Oracle type: 1 for Chainlink, 2 for Pyth"),
    },
    handler: async (args) => {
        try {
            const { client, address, signer } = await resolveClient();
            const raw = await adjustMarginSvc(client, address, args);
            const normalized = raw?.__normalized;
            if (raw && typeof raw === "object" && "__normalized" in raw) {
                delete raw.__normalized;
            }
            const data = await finalizeMutationResult(raw, signer, "adjust_margin");
            const payload = normalized ? { ...data, normalized } : data;
            return { content: [{ type: "text", text: JSON.stringify({ status: "success", data: payload }, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2) }] };
        }
        catch (error) {
            return { content: [{ type: "text", text: `Error: ${extractErrorMessage(error)}` }], isError: true };
        }
    },
};
