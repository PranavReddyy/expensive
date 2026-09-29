"use client";
import { createContext, useContext } from "react";

export const AuthContext = createContext({ user: null, ready: false });
export const useAuth = () => useContext(AuthContext);
