import { createContext, useContext } from "react";

// Fourni par VaultGate : verrouiller, afficher une nouvelle clé de secours.
export const VaultContext = createContext({ lock: () => {}, showRecoveryKey: () => {} });
export const useVault = () => useContext(VaultContext);
