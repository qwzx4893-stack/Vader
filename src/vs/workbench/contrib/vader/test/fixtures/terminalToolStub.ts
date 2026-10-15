// The one thing the terminal page takes from the terminal service module that is not a type: how a persistent terminal is named.
export const persistentTerminalNameOfId = (id: string) => id === '1' ? 'Vader Agent' : `Vader Agent (${id})`
