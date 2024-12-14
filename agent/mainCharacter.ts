import { Character, ModelProviderName, defaultCharacter, Clients } from "@ai16z/eliza";
import { evmPlugin } from "@ai16z/plugin-evm";
import tmaiCharacter from "../characters/tmai.character.json" with { type: "json" };;

export const mainCharacter: Character = {
    ...tmaiCharacter,
    modelProvider: tmaiCharacter.modelProvider as ModelProviderName,
    clients: tmaiCharacter.clients as Clients[],
};
