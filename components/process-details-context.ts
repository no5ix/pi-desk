"use client";

import { createContext } from "react";

/**
 * True inside a turn's "Process details" group (components/ChatWindow.tsx).
 *
 * The group is the collapsed record of how a turn worked. Opening it reveals the steps,
 * it does not dump their text: a thinking card inside the group opens collapsed even
 * when the "expand thinking by default" preference is on (the preference keeps working
 * for a thinking card shown on its own, and for a live reply).
 *
 * A context, because the group's children are produced by the message renderer several
 * layers away — prop-drilling a flag through MessageView, BlockView and the tool views
 * would touch a chain of upstream-owned signatures.
 */
export const ProcessDetailsContext = createContext(false);
