import { createContext } from "react";

// Partagé par les cartes de l'organigramme (évite de tout passer en props).
export const ChartContext = createContext(null);
