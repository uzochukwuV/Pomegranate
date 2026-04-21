import { resolveClient } from "../auth/resolveClient.js";
export const systemStateResource = {
    uri: "system://state",
    name: "System and Network State",
    description: "Readonly contextual data about the connected EVM network, wallet address, and chain ID.",
    mimetype: "application/json",
    read: async () => {
        try {
            const { address, chainId } = await resolveClient();
            return {
                address,
                chainId,
                rpcHealth: "healthy",
                timestamp: new Date().toISOString()
            };
        }
        catch (e) {
            return { error: e.message, status: "unavailable" };
        }
    }
};
