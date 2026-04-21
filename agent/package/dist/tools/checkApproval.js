import { z } from "zod";
import { resolveClient, getChainId, getQuoteToken } from "../auth/resolveClient.js";
import { normalizeAddress } from "../utils/address.js";
import { finalizeMutationResult } from "../utils/mutationResult.js";
const MAX_UINT256 = "115792089237316195423570985008687907853269984665640564039457584007913129639935";
export const checkApprovalTool = {
    name: "check_approval",
    description: "[TRADE] Check if token spending approval is needed. Supports auto-approve exact amount (default) or optional unlimited approval.",
    schema: {
        amount: z.string().regex(/^\d+$/).describe("Amount to check approval for (token raw units)"),
        quoteToken: z.string().optional().describe("Token address to check. Uses default if omitted."),
        autoApprove: z.boolean().optional().describe("If true, automatically approve when needed."),
        approveMax: z.boolean().optional().describe("If true with autoApprove, approve unlimited MaxUint256 (default false: approve exact amount only)."),
    },
    handler: async (args) => {
        try {
            const { client, address, signer } = await resolveClient();
            const chainId = getChainId();
            const quoteToken = normalizeAddress(args.quoteToken || getQuoteToken(), "quoteToken");
            const needApproval = await client.utils.needsApproval(address, chainId, quoteToken, args.amount);
            if (needApproval && args.autoApprove) {
                const approveAmount = args.approveMax ? MAX_UINT256 : args.amount;
                const raw = await client.utils.approveAuthorization({
                    chainId,
                    quoteAddress: quoteToken,
                    amount: approveAmount,
                });
                const approval = await finalizeMutationResult(raw, signer, "approve_authorization");
                return { content: [{ type: "text", text: JSON.stringify({ status: "success", data: { needApproval: true, approved: true, quoteToken, approvedAmount: approveAmount, approveMax: !!args.approveMax, approval } }, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2) }] };
            }
            return { content: [{ type: "text", text: JSON.stringify({ status: "success", data: { needApproval, approved: false, quoteToken } }, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2) }] };
        }
        catch (error) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
    },
};
