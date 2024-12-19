import { Character, ModelProviderName, defaultCharacter, Clients } from "@ai16z/eliza";
import tmaiCharacter from "../characters/tmai.character.json" with { type: "json" };
import { evmPlugin } from "@ai16z/plugin-evm";
import { solanaPlugin } from "@ai16z/plugin-solana";

export const mainCharacter: Character = {
    ...tmaiCharacter,
    modelProvider: tmaiCharacter.modelProvider as ModelProviderName,
    clients: tmaiCharacter.clients as Clients[],
    plugins: [evmPlugin, solanaPlugin],
    settings: {
        chains: {
            evm: ["base"],
            solana: ["mainnet-beta"]
        },
    },
};