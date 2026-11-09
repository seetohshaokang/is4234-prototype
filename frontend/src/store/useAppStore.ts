import { create } from "zustand";

interface AppStore {
  actorId: string;
  simDate: string;
  setActor: (id: string) => void;
  setSimDate: (date: string) => void;
}

export const useAppStore = create<AppStore>((set) => ({
  actorId: "P-MARCUS",
  simDate: "2017-11-15",
  setActor: (id) => set({ actorId: id }),
  setSimDate: (date) => set({ simDate: date }),
}));
