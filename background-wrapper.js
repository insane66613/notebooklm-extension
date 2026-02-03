// Background Wrapper: Loads both original and extended background scripts

// Load original background (it's an IIFE so it runs on import)
import "./background.js";

// Load ExtendLM additions
import "./extendlm-background.js";
