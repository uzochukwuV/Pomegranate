import { getPositions } from "../services/positionService.js";
import { resolveClient } from "../auth/resolveClient.js";
export const tradeAnalysisPrompt = {
    name: "analyze_positions",
    description: "Analyze the user's current trading positions based on real-time market action.",
    arguments: [
        {
            name: "marketContext",
            description: "Provide the latest market insights or news to contextualize the analysis.",
            required: false
        }
    ],
    run: async (args) => {
        try {
            const { client, address } = await resolveClient();
            const positions = await getPositions(client, address);
            return {
                messages: [
                    {
                        role: "user",
                        content: {
                            type: "text",
                            text: `Analyze this user's trading portfolio with professional rigor:

Positions: ${JSON.stringify(positions, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2)}

Market Context: ${args?.marketContext || "None provided"}

## Analysis Requirements:
1. **Risk Level**: Calculate current margin health and distance to liquidation price.
2. **PnL Review**: Evaluate performance and identify if SL/TP are appropriately placed.
3. **Actionable Suggestions**: Suggest specific size adjustments or TP/SL updates based on context.
4. **Funding Outlook**: Brief comment on funding fee impacts if observable.`
                        }
                    }
                ]
            };
        }
        catch (e) {
            throw new Error(`Failed to generate prompt: ${e.message}`);
        }
    }
};
