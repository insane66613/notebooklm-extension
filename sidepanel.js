import "/chunks/popup-C3v0qDyE.js";

/**
 * Client for interacting with the NotebookLM Internal API.
 * Reverse engineered from the official extension's offscreen.js.
 */
class NotebookLMClient {
    constructor() {
        this.baseUrl = "https://notebooklm.google.com";
        this.authData = null;
    }

    /**
     * Helper to generate a random query ID for requests.
     */
    _reqid() {
        const min = 100000;
        const max = 999999;
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    /**
     * Fetches the authentication tokens (at, bl, sid) from the NotebookLM homepage.
     * Corresponds to `ot()` in the original source.
     */
    async getTokens() {
        try {
            console.log("Fetching NotebookLM tokens...");
            const response = await fetch(this.baseUrl, {
                credentials: "include", // Important: Uses the user's cookies
                headers: {
                    "Accept": "text/html",
                    "Cache-Control": "no-cache, no-store, must-revalidate",
                    "Upgrade-Insecure-Requests": "1"
                }
            });

            if (!response.ok) {
                throw new Error(`Failed to load NotebookLM: ${response.status}`);
            }

            const text = await response.text();

            // 1. Try to find the XSRF token (often called SNlM0e or at)
            // MatchSNlM0e: "SNlM0e":"..."
            let at = null;
            const snlMatch = text.match(/"SNlM0e"\s*:\s*"([^"]+)"/);
            const atMatch = text.match(/"at"\s*:\s*"([^"]+)"/) ||
                text.match(/input[^>]*name="at"[^>]*value="([^"]+)"/) ||
                text.match(/input[^>]*value="([^"]+)"[^>]*name="at"/);

            at = snlMatch ? snlMatch[1] : (atMatch ? atMatch[1] : null);

            if (!at) {
                // Last ditch effort: scan for raw SNlM0e in script blocks
                const lastResort = text.match(/SNlM0e\s*[:=]\s*['"]([^'"]+)['"]/);
                at = lastResort ? lastResort[1] : null;
            }

            if (!at) {
                console.error("DEBUG: Page content length:", text.length);
                console.error("DEBUG: Sample content:", text.substring(0, 500));
                throw new Error("Could not find Auth Token (at/SNlM0e). Are you logged in to NotebookLM in this browser profile?");
            }

            // 2. Find Build Label (bl)
            const blMatch = text.match(/"bl"\s*:\s*"([^"]+)"/) ||
                text.match(/bl=([^'"&]+)/);
            const bl = blMatch ? blMatch[1] : "boq_labs-tailwind-frontend_20230101.00_p0";

            // 3. Find Session ID (sid)
            const sidMatch = text.match(/"f\.sid"\s*:\s*"([^"]+)"/) ||
                text.match(/"sid"\s*:\s*"([^"]+)"/);
            const sid = sidMatch ? sidMatch[1].replace(/"/g, "") : null;

            this.authData = { at, bl, sid };

            console.log("Tokens retrieved successfully.", { bl, hasSid: !!sid });
            return this.authData;

        } catch (error) {
            console.error("Auth Error:", error);
            throw error;
        }
    }

    /**
     * Adds a URL to a specific notebook.
     * Corresponds to `tt()` and uses the `izAoDd` RPC.
     * 
     * @param {string} notebookId - The ID of the notebook.
     * @param {string} url - The URL to add.
     */
    async addUrl(notebookId, url) {
        if (!this.authData) {
            await this.getTokens();
        }

        const endpoint = `${this.baseUrl}/_/LabsTailwindUi/data/batchexecute`;

        // Construct the RPC payload for `izAoDd`
        // Structure reverse-engineered:
        // [ [ [null,null,null,null,null,null,null,null,null,null,1], "URL" ] ] wrapped in JSON
        // Then wrapped in the standard batchexecute envelope

        // Inner payload: The "source definition"
        // [null, null, [url], ...] - This part is tricky, let's match the `Q` function output exactly.
        // The original `Q` logic was:
        // const s = n.map(t => { const e = [null...]; e[2]=[t]; return e; })
        // where `e` has 11 nulls then 1.

        // Simplified source object structure based on `Q`:
        const sourceObject = [
            null, null, // indices 0, 1
            [url],      // index 2: The URL list?
            null, null, null, null, null, null, null,
            1           // index 10?
        ];
        // Wait, `Q` logic: `e` is array of 11 items. `e[2] = [t]`. 
        // e = [null, null, [url], null, null, null, null, null, null, null, 1]

        const sourcesList = [sourceObject];

        // Then `o` (the payload) = JSON.stringify([sourcesList, notebookId, [2], [1, null... [1]]])
        const innerPayload = JSON.stringify([
            sourcesList,
            notebookId,
            [2], // Type?
            [1, null, null, null, null, null, null, null, null, null, [1]] // Config?
        ]);

        const rpcPayload = JSON.stringify([
            [["izAoDd", innerPayload, null, "generic"]]
        ]);

        const params = new URLSearchParams();
        params.append("rpcids", "izAoDd");
        params.append("source-path", `/notebook/${notebookId}`);
        params.append("bl", this.authData.bl);
        params.append("rt", "c"); // Response type?
        params.append("_reqid", this._reqid());

        // Post body needs 'f.req' and 'at'
        const bodyParams = new URLSearchParams();
        bodyParams.append("f.req", rpcPayload);
        bodyParams.append("at", this.authData.at);

        try {
            console.log(`Adding URL ${url} to notebook ${notebookId}...`);
            const response = await fetch(`${endpoint}?${params.toString()}`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
                    "X-Same-Domain": "1"
                },
                body: bodyParams,
                credentials: "include"
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`API Request Failed: ${response.status} - ${errText.substring(0, 100)}`);
            }

            const responseText = await response.text();
            // Parse response (it's a weird JSON with line breaks)
            // Need to handle the unique Google response format if we want the ID, 
            // but for now verifying 200 OK is a good start.
            console.log("Add URL Response:", responseText.substring(0, 200));

            return { success: true };

        } catch (error) {
            console.error("Add URL Error:", error);
            return { success: false, error: error.message };
        }
    }
    /**
     * Fetches all notebooks and their sources.
     * Corresponds to `j()` and uses `wXbhsf` RPC.
     */
    async getNotebooks() {
        if (!this.authData) {
            await this.getTokens();
        }

        const endpoint = `${this.baseUrl}/_/LabsTailwindUi/data/batchexecute`;

        // Payload: [null, 500] -> possibly [pagination_token, limit]
        const innerPayload = JSON.stringify([null, 500]);
        const rpcPayload = JSON.stringify([
            [["wXbhsf", innerPayload, null, "generic"]]
        ]);

        const params = new URLSearchParams();
        params.append("rpcids", "wXbhsf");
        params.append("_reqid", this._reqid());
        params.append("bl", this.authData.bl);
        params.append("rt", "c");

        const bodyParams = new URLSearchParams();
        bodyParams.append("f.req", rpcPayload);
        bodyParams.append("at", this.authData.at);

        try {
            const response = await fetch(`${endpoint}?${params.toString()}`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
                    "X-Same-Domain": "1"
                },
                body: bodyParams,
                credentials: "include"
            });

            if (!response.ok) throw new Error("Failed to fetch notebooks");

            const text = await response.text();
            // Parse the batchexecute response
            const data = this._parseBatchExecuteResponse(text, "wXbhsf");

            if (!data || !data[0]) return [];

            // data[0] is the inner payload for wXbhsf
            // Structure: Array of notebooks?
            // notebooks = data[0][0]
            const notebooksRaw = data[0][0];
            if (!Array.isArray(notebooksRaw)) return [];

            return notebooksRaw.map(nb => {
                if (!nb || !Array.isArray(nb)) return null;

                const id = nb[2];
                const title = nb[0];
                const sourcesRaw = (Array.isArray(nb[1])) ? nb[1] : [];

                const sources = sourcesRaw.map(src => {
                    if (!src || !Array.isArray(src)) return null;
                    // src structure: [id, title, [..., urlInfo, ...]]
                    // Based on `lt` function:
                    // url is in src[2][5] or src[2][7] usually
                    const srcId = src[0] && src[0].length > 0 ? src[0][0] : "";
                    const srcTitle = src[1] || "Untitled";
                    let srcUrl = "";

                    try {
                        const metadata = src[2];
                        if (metadata) {
                            if (Array.isArray(metadata[5])) srcUrl = metadata[5][0];
                            else if (Array.isArray(metadata[7])) srcUrl = metadata[7][0];
                        }
                    } catch (e) {
                        // ignore
                    }

                    return { id: srcId, title: srcTitle, url: srcUrl };
                }).filter(s => s !== null);

                return { id, title, sources };
            }).filter(nb => nb !== null);

        } catch (error) {
            console.error("Get Notebooks Error:", error);
            return [];
        }
    }

    /**
     * Deletes a source from a notebook.
     * Corresponds to `dt()` and uses `tGMBJ` RPC.
     */
    async deleteSource(notebookId, sourceId) {
        if (!this.authData) {
            await this.getTokens();
        }

        const endpoint = `${this.baseUrl}/_/LabsTailwindUi/data/batchexecute`;

        // Payload: [[[sourceId]], [2]]
        const innerPayload = JSON.stringify([[[sourceId]], [2]]);
        const rpcPayload = JSON.stringify([
            [["tGMBJ", innerPayload, null, "generic"]]
        ]);

        const params = new URLSearchParams();
        params.append("rpcids", "tGMBJ");
        params.append("source-path", `/notebook/${notebookId}`);
        params.append("_reqid", this._reqid());
        params.append("bl", this.authData.bl);
        params.append("rt", "c");
        if (this.authData.sid) params.append("f.sid", this.authData.sid);

        const bodyParams = new URLSearchParams();
        bodyParams.append("f.req", rpcPayload);
        bodyParams.append("at", this.authData.at);

        try {
            const response = await fetch(`${endpoint}?${params.toString()}`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
                    "X-Same-Domain": "1"
                },
                body: bodyParams,
                credentials: "include"
            });

            if (!response.ok) throw new Error("Failed to delete source");
            return { success: true };

        } catch (error) {
            console.error("Delete Source Error:", error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Creates a new notebook.
     * Corresponds to `CCqFvf` RPC.
     */
    async createNotebook(title = "") {
        if (!this.authData) {
            await this.getTokens();
        }

        const endpoint = `${this.baseUrl}/_/LabsTailwindUi/data/batchexecute`;

        const innerPayload = JSON.stringify([
            title,
            null,
            null,
            [2],
            [1, null, null, null, null, null, null, null, null, null, [1]]
        ]);
        const rpcPayload = JSON.stringify([
            [["CCqFvf", innerPayload, null, "generic"]]
        ]);

        const params = new URLSearchParams();
        params.append("rpcids", "CCqFvf");
        params.append("_reqid", this._reqid());
        params.append("bl", this.authData.bl);
        params.append("rt", "c");

        const bodyParams = new URLSearchParams();
        bodyParams.append("f.req", rpcPayload);
        bodyParams.append("at", this.authData.at);

        try {
            console.log(`Creating notebook: ${title || 'Untitled'}...`);
            const response = await fetch(`${endpoint}?${params.toString()}`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
                    "X-Same-Domain": "1"
                },
                body: bodyParams,
                credentials: "include"
            });

            if (!response.ok) throw new Error("Failed to create notebook");

            const text = await response.text();
            const data = this._parseBatchExecuteResponse(text, "CCqFvf");

            if (data && data[0]) {
                return { success: true, id: data[0] };
            }

            return { success: true };

        } catch (error) {
            console.error("Create Notebook Error:", error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Renames a source in a notebook.
     * Corresponds to `b7Wfje` RPC.
     */
    async renameSource(notebookId, sourceId, newName) {
        if (!this.authData) {
            await this.getTokens();
        }

        const endpoint = `${this.baseUrl}/_/LabsTailwindUi/data/batchexecute`;

        // Payload: [null, ["SOURCE_ID"], [[["NEW_NAME"]]]]
        const innerPayload = JSON.stringify([
            null,
            [sourceId],
            [[[newName]]]
        ]);
        const rpcPayload = JSON.stringify([
            [["b7Wfje", innerPayload, null, "generic"]]
        ]);

        const params = new URLSearchParams();
        params.append("rpcids", "b7Wfje");
        params.append("source-path", `/notebook/${notebookId}`);
        params.append("_reqid", this._reqid());
        params.append("bl", this.authData.bl);
        params.append("rt", "c");

        const bodyParams = new URLSearchParams();
        bodyParams.append("f.req", rpcPayload);
        bodyParams.append("at", this.authData.at);

        try {
            console.log(`Renaming source ${sourceId} to ${newName}...`);
            const response = await fetch(`${endpoint}?${params.toString()}`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
                    "X-Same-Domain": "1"
                },
                body: bodyParams,
                credentials: "include"
            });

            if (!response.ok) throw new Error("Failed to rename source");
            return { success: true };

        } catch (error) {
            console.error("Rename Source Error:", error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Helper to parse the Google batchexecute response format.
     * It looks like JSON lines, but with a length prefix passed in `ht`.
     * We'll implement a simplified parser.
     */
    _parseBatchExecuteResponse(text, rpcid) {
        try {
            // Find the envelope for the specific rpcid using regex
            // Format: ["wrb.fr","RPCID","JSON_STRING",...]
            // The JSON_STRING part is double-escaped.
            const pattern = new RegExp(`\\["wrb\\.fr"\\s*,\\s*"${rpcid}"\\s*,\\s*"((?:[^"\\\\\\\\\\"]|\\\\\\\\.)*)"`, 's');
            const match = text.match(pattern);
            
            if (match && match[1]) {
                // The match[1] is the inner JSON string, but it's still escaped.
                // We use JSON.parse to unescape it by wrapping it in quotes.
                const unescaped = JSON.parse(`"${match[1]}"`);
                return JSON.parse(unescaped);
            }

            // Fallback for standard array-of-arrays format (stripping length prefixes if any)
            const cleanLines = text.replace(/^\)\]\}\'\n/, "").split('\n').filter(l => l.trim() && !/^\d+$/.test(l.trim()));
            for (const line of cleanLines) {
                try {
                    const parsed = JSON.parse(line);
                    // The line could be a single envelope or an array of envelopes
                    const envelopes = Array.isArray(parsed[0]) ? parsed : [parsed];
                    for (const envelope of envelopes) {
                        if (envelope[0] === "wrb.fr" && envelope[1] === rpcid) {
                            return JSON.parse(envelope[2]);
                        }
                    }
                } catch (e) { continue; }
            }
            return null;
        } catch (e) {
            console.error("Parse Error for RPC", rpcid, e);
            return null;
        }
    }

}


// Instantiate the client
const notebookLM = new NotebookLMClient();


// Wait for the React app to render its root
const waitForRoot = setInterval(() => {
    const root = document.getElementById('root');
    if (root && root.children.length > 0) {
        clearInterval(waitForRoot);
        injectAdvancedFeatures();
    }
}, 100);

function injectAdvancedFeatures() {
    const container = document.createElement('div');
    container.id = 'extendlm-advanced-features';
    container.className = 'px-4 py-3 border-t border-slate-200 bg-slate-50 extendlm-panel';

    container.innerHTML = `
        <style>
            .extendlm-panel.dark { background: #1e293b; border-color: #334155; }
            .extendlm-panel.dark h2, .extendlm-panel.dark label { color: #e2e8f0; }
            .extendlm-panel.dark button { background: #334155; color: #e2e8f0; border-color: #475569; }
            .extendlm-panel.dark button:hover { background: #475569; }
            .extendlm-panel.dark input, .extendlm-panel.dark textarea, .extendlm-panel.dark select { background: #1e293b; color: #e2e8f0; border-color: #475569; }
            .extendlm-panel.dark .text-slate-500 { color: #94a3b8; }
        </style>
        
        <div class="flex justify-between items-center mb-2">
            <h2 class="text-xs font-bold text-slate-800 uppercase tracking-wider">ExtendLM Tools</h2>
            <button id="btn-dark-mode" class="text-xs px-2 py-1 bg-slate-200 rounded hover:bg-slate-300" title="Toggle Dark Mode">🌙</button>
        </div>
        
        <!-- Notebook Management -->
        <div class="mb-3 space-y-2">
            <div>
                <label class="text-xs text-slate-600 block mb-1">Target Notebook:</label>
                <div class="flex gap-1">
                    <select id="notebook-selector" class="flex-grow px-2 py-1 text-xs border border-slate-300 rounded">
                        <option value="">Loading notebooks...</option>
                    </select>
                    <button id="btn-refresh-notebooks" class="px-2 py-1 bg-slate-200 rounded hover:bg-slate-300" title="Refresh List">🔄</button>
                </div>
            </div>
            <div id="create-notebook-container" class="flex gap-1">
                <input type="text" id="new-notebook-title" placeholder="New notebook name..." class="flex-grow px-2 py-1 text-xs border border-slate-300 rounded">
                <button id="btn-create-notebook" class="px-2 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700">Create</button>
            </div>
        </div>
        
        <div class="space-y-2">
            <!-- YouTube Playlist -->
            <button id="btn-yt-playlist" class="w-full px-3 py-2 bg-white text-slate-700 text-xs font-medium rounded border border-slate-200 hover:bg-slate-50 text-left flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-red-600"><path d="M2.5 17a24.12 24.12 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49.56 49.56 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24.12 24.12 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49.55 49.55 0 0 1-16.2 0A2 2 0 0 1 2.5 17"/><path d="m10 15 5-3-5-3z"/></svg>
                Import YouTube Playlist
            </button>
            <div id="yt-playlist-progress" class="hidden text-xs text-slate-500 pl-6"></div>

            <!-- RSS Feed -->
            <button id="btn-rss-feed" class="w-full px-3 py-2 bg-white text-slate-700 text-xs font-medium rounded border border-slate-200 hover:bg-slate-50 text-left flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-orange-500"><path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1"/></svg>
                Import RSS Feed
            </button>
            <div id="rss-input-container" class="hidden mt-2">
                <input type="text" id="rss-url" placeholder="https://example.com/feed.xml" class="w-full px-2 py-1 text-xs border border-slate-300 rounded mb-1 focus:outline-none focus:border-blue-500">
                <button id="btn-rss-fetch" class="w-full px-2 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700">Fetch Items</button>
            </div>
            
            <!-- Bookmarks -->
            <button id="btn-bookmarks-import" class="w-full px-3 py-2 bg-white text-slate-700 text-xs font-medium rounded border border-slate-200 hover:bg-slate-50 text-left flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-yellow-500"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/></svg>
                Import from Bookmarks
            </button>
            <div id="bookmarks-container" class="hidden mt-2">
                <select id="bookmark-folder" class="w-full px-2 py-1 text-xs border border-slate-300 rounded mb-1">
                    <option value="">Loading folders...</option>
                </select>
                <button id="btn-bookmarks-go" class="w-full px-2 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700">Import Folder</button>
            </div>

            <!-- Page Selector -->
            <button id="btn-page-selector" class="w-full px-3 py-2 bg-white text-slate-700 text-xs font-medium rounded border border-slate-200 hover:bg-slate-50 text-left flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-indigo-500"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>
                Webpage Selector Import
            </button>
            
            <!-- Batch URL Import -->
            <button id="btn-batch-import" class="w-full px-3 py-2 bg-white text-slate-700 text-xs font-medium rounded border border-slate-200 hover:bg-slate-50 text-left flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-blue-500"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                Batch Import URLs
            </button>
            <div id="batch-input-container" class="hidden mt-2">
                <textarea id="batch-urls" placeholder="Paste URLs, one per line..." class="w-full px-2 py-1 text-xs border border-slate-300 rounded mb-1 h-20 resize-none"></textarea>
                <button id="btn-batch-go" class="w-full px-2 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700">Import All</button>
            </div>
            <div id="batch-progress" class="hidden text-xs text-slate-500 pl-6"></div>
            
            <!-- Remove Duplicates -->
            <button id="btn-dedupe" class="w-full px-3 py-2 bg-white text-slate-700 text-xs font-medium rounded border border-slate-200 hover:bg-slate-50 text-left flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-gray-500"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                Remove Duplicate Sources
            </button>
            <div id="dedupe-progress" class="hidden text-xs text-slate-500 pl-6"></div>

            <!-- Bulk Rename -->
            <button id="btn-bulk-rename" class="w-full px-3 py-2 bg-white text-slate-700 text-xs font-medium rounded border border-slate-200 hover:bg-slate-50 text-left flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-pink-500"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
                Bulk Source Rename
            </button>
            <div id="rename-input-container" class="hidden mt-2">
                <input type="text" id="rename-prefix" placeholder="Prefix (optional)" class="w-full px-2 py-1 text-xs border border-slate-300 rounded mb-1">
                <input type="text" id="rename-suffix" placeholder="Suffix (optional)" class="w-full px-2 py-1 text-xs border border-slate-300 rounded mb-1">
                <button id="btn-rename-go" class="w-full px-2 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700">Apply to All</button>
            </div>
            
            <!-- Export Sources -->
            <button id="btn-export" class="w-full px-3 py-2 bg-white text-slate-700 text-xs font-medium rounded border border-slate-200 hover:bg-slate-50 text-left flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-green-500"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                Export Sources (JSON)
            </button>
            
            <!-- Source Health Check -->
            <button id="btn-health-check" class="w-full px-3 py-2 bg-white text-slate-700 text-xs font-medium rounded border border-slate-200 hover:bg-slate-50 text-left flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-purple-500"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                Check Source URLs (404)
            </button>
            <div id="health-progress" class="hidden text-xs text-slate-500 pl-6"></div>
        </div>
        
        <!-- Import History -->
        <div class="mt-3 pt-3 border-t border-slate-200">
            <div class="flex justify-between items-center mb-1">
                <span class="text-xs font-bold text-slate-600 uppercase">Import History</span>
                <button id="btn-clear-history" class="text-xs text-slate-400 hover:text-slate-600">Clear</button>
            </div>
            <div id="import-history" class="max-h-24 overflow-y-auto text-xs text-slate-500 space-y-1"></div>
        </div>
    `;

    document.body.appendChild(container);

    // Load saved dark mode preference
    chrome.storage.local.get("extendlmDarkMode", (data) => {
        if (data.extendlmDarkMode) container.classList.add("dark");
    });

    // Load notebooks into selector
    loadNotebookSelector();

    // Check for pending import from context menu
    checkPendingImport();

    // Load import history
    loadImportHistory();

    // Initial check for YouTube Playlist
    checkURLForPlaylist();

    // Event Listeners
    document.getElementById('btn-refresh-notebooks').addEventListener('click', loadNotebookSelector);
    document.getElementById('btn-create-notebook').addEventListener('click', handleCreateNotebook);
    
    document.getElementById('btn-yt-playlist').addEventListener('click', handlePlaylistImport);
    document.getElementById('btn-rss-feed').addEventListener('click', () => {
        document.getElementById('rss-input-container').classList.toggle('hidden');
    });
    document.getElementById('btn-rss-fetch').addEventListener('click', handleRSSImport);
    
    document.getElementById('btn-bookmarks-import').addEventListener('click', handleBookmarksToggle);
    document.getElementById('btn-bookmarks-go').addEventListener('click', handleBookmarksImport);
    
    document.getElementById('btn-page-selector').addEventListener('click', handlePageSelector);
    
    document.getElementById('btn-batch-import').addEventListener('click', () => {
        document.getElementById('batch-input-container').classList.toggle('hidden');
    });
    document.getElementById('btn-batch-go').addEventListener('click', handleBatchImport);
    document.getElementById('btn-dedupe').addEventListener('click', handleRemoveDuplicates);
    
    document.getElementById('btn-bulk-rename').addEventListener('click', () => {
        document.getElementById('rename-input-container').classList.toggle('hidden');
    });
    document.getElementById('btn-rename-go').addEventListener('click', handleBulkRenameApply);
    
    document.getElementById('btn-export').addEventListener('click', handleExportSources);
    document.getElementById('btn-health-check').addEventListener('click', handleHealthCheck);
    document.getElementById('btn-dark-mode').addEventListener('click', toggleDarkMode);
    document.getElementById('btn-clear-history').addEventListener('click', clearImportHistory);
}

async function checkURLForPlaylist() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url && tab.url.includes('youtube.com/playlist')) {
        document.getElementById('btn-yt-playlist').classList.remove('opacity-50', 'pointer-events-none');
        document.getElementById('btn-yt-playlist').innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-red-600"><path d="M2.5 17a24.12 24.12 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49.56 49.56 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24.12 24.12 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49.55 49.55 0 0 1-16.2 0A2 2 0 0 1 2.5 17"/><path d="m10 15 5-3-5-3z"/></svg>
            Import Detected Playlist
        `;
    } else {
        document.getElementById('btn-yt-playlist').classList.add('opacity-50', 'pointer-events-none');
        document.getElementById('btn-yt-playlist').innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-slate-400"><path d="M2.5 17a24.12 24.12 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49.56 49.56 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24.12 24.12 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49.55 49.55 0 0 1-16.2 0A2 2 0 0 1 2.5 17"/><path d="m10 15 5-3-5-3z"/></svg>
            No Playlist Detected
        `;
    }
}

async function getCurrentNotebookId() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url) return null;
    // Matches /notebook/UUID
    const match = tab.url.match(/notebook\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : null;
}

async function handlePlaylistImport() {
    const progressDiv = document.getElementById('yt-playlist-progress');
    progressDiv.classList.remove('hidden');
    progressDiv.textContent = "Checking context...";

    const notebookId = await getCurrentNotebookId();
    if (!notebookId) {
        progressDiv.textContent = "Error: Open a Notebook first.";
        alert("Please open a specific NotebookLM notebook first.");
        return;
    }

    progressDiv.textContent = "Scanning page for videos...";

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    // Execute a script in the page to get all video links
    const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
            // Scrape all playlist video links
            const anchors = Array.from(document.querySelectorAll('a[href*="/watch?v="]'));
            const videos = new Set();
            anchors.forEach(a => {
                const url = new URL(a.href);
                if (url.searchParams.has('v')) {
                    videos.add('https://www.youtube.com/watch?v=' + url.searchParams.get('v'));
                }
            });
            return Array.from(videos);
        }
    });

    const videos = results[0].result;
    progressDiv.textContent = `Found ${videos.length} videos. Queuing...`;

    console.log("Importing videos to notebook", notebookId, videos);

    for (let i = 0; i < videos.length; i++) {
        progressDiv.textContent = `Importing ${i + 1}/${videos.length}: ${videos[i]}`;

        const result = await notebookLM.addUrl(notebookId, videos[i]);

        if (!result.success) {
            console.error(`Failed to import ${videos[i]}:`, result.error);
            // Optional: Continue or stop? Let's continue.
        }

        // Rate limiting: 1 second delay
        await new Promise(r => setTimeout(r, 1000));
    }
    progressDiv.textContent = "Import Complete!";
}

async function handleRSSImport() {
    const url = document.getElementById('rss-url').value;
    if (!url) return;

    const btn = document.getElementById('btn-rss-fetch');

    const notebookId = await getCurrentNotebookId();
    if (!notebookId) {
        alert("Please open a specific NotebookLM notebook first.");
        return;
    }

    btn.textContent = "Fetching Feed...";
    btn.disabled = true;

    try {
        // Request permission if needed
        const urlObj = new URL(url);
        const origin = urlObj.origin + "/*";

        const granted = await chrome.permissions.request({
            origins: [origin]
        });

        if (!granted) {
            alert("Permission denied. Cannot fetch feed.");
            return;
        }

        const response = await fetch(url);
        const text = await response.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(text, "text/xml");

        const items = Array.from(doc.querySelectorAll("item, entry"));
        const links = items.map(item => {
            const link = item.querySelector("link");
            return link ? (link.textContent || link.getAttribute('href')) : null;
        }).filter(l => l);

        if (links.length === 0) {
            alert("No links found in feed.");
            return;
        }

        if (!confirm(`Found ${links.length} items. Import to NotebookLM?`)) {
            return;
        }

        btn.textContent = "Importing...";

        for (let i = 0; i < links.length; i++) {
            btn.textContent = `Importing ${i + 1}/${links.length}`;
            await notebookLM.addUrl(notebookId, links[i]);
            await new Promise(r => setTimeout(r, 1000));
        }

        btn.textContent = "Done!";
        setTimeout(() => { btn.textContent = "Fetch Items"; btn.disabled = false; }, 2000);

    } catch (e) {
        alert("Error fetching feed: " + e.message);
        btn.textContent = "Fetch Items";
        btn.disabled = false;

    }
}

async function handleRemoveDuplicates() {
    const btn = document.getElementById('btn-dedupe');
    const progressDiv = document.getElementById('dedupe-progress');

    // Reset UI
    progressDiv.textContent = "Fetching sources...";
    progressDiv.classList.remove('hidden');
    btn.disabled = true;

    try {
        const currentNotebookId = await getCurrentNotebookId();
        if (!currentNotebookId) {
            alert("Please open a Notebook first.");
            throw new Error("No notebook open");
        }

        // 1. Fetch all notebooks
        const notebooks = await notebookLM.getNotebooks();

        // 2. Find current notebook
        const currentNotebook = notebooks.find(nb => nb.id === currentNotebookId);

        if (!currentNotebook || !currentNotebook.sources || currentNotebook.sources.length === 0) {
            progressDiv.textContent = "No sources found.";
            alert("No sources found in this notebook.");
            return;
        }

        // 3. Identify duplicates
        const seenUrls = new Set();
        const seenTitles = new Set();
        const duplicates = [];

        currentNotebook.sources.forEach(source => {
            let isDuplicate = false;
            // Normalize URL: remove trailing slashes, etc if needed.
            // For now, exact string match.
            if (source.url) {
                if (seenUrls.has(source.url)) isDuplicate = true;
                else seenUrls.add(source.url);
            } else {
                // Fallback to title for uploads without URL
                if (seenTitles.has(source.title)) isDuplicate = true;
                else seenTitles.add(source.title);
            }

            if (isDuplicate) {
                duplicates.push(source);
            }
        });

        if (duplicates.length === 0) {
            progressDiv.textContent = "No duplicates found.";
            alert("No duplicates found!");
            return;
        }

        if (!confirm(`Found ${duplicates.length} duplicate sources. Delete them?`)) {
            progressDiv.textContent = "Cancelled.";
            return;
        }

        // 4. Batch delete
        progressDiv.textContent = `Deleting ${duplicates.length} duplicates...`;

        for (let i = 0; i < duplicates.length; i++) {
            const source = duplicates[i];
            progressDiv.textContent = `Deleting ${i + 1}/${duplicates.length}: ${source.title}`;

            await notebookLM.deleteSource(currentNotebookId, source.id);
            await new Promise(r => setTimeout(r, 800)); // Delay to be safe
        }

        progressDiv.textContent = "Deletion Complete!";

    } catch (e) {
        console.error(e);
        progressDiv.textContent = "Error: " + e.message;
    } finally {
        btn.disabled = false;
        setTimeout(() => {
            if (progressDiv.textContent === "Deletion Complete!") progressDiv.classList.add('hidden');
        }, 5000);
    }
}

// ============== NEW FEATURES ==============

// Load notebooks into the dropdown selector
async function loadNotebookSelector() {
    const selector = document.getElementById('notebook-selector');
    try {
        const notebooks = await notebookLM.getNotebooks();
        selector.innerHTML = '<option value="">Select a notebook...</option>';
        notebooks.forEach(nb => {
            const opt = document.createElement('option');
            opt.value = nb.id;
            opt.textContent = nb.title || `Notebook ${nb.id.substring(0, 8)}`;
            selector.appendChild(opt);
        });

        // Auto-select current notebook if on NotebookLM
        const currentId = await getCurrentNotebookId();
        if (currentId) {
            selector.value = currentId;
        }
    } catch (e) {
        selector.innerHTML = '<option value="">Error loading notebooks</option>';
    }
}

// Get selected notebook ID (from dropdown or URL)
async function getTargetNotebookId() {
    const selector = document.getElementById('notebook-selector');
    if (selector && selector.value) {
        return selector.value;
    }
    return await getCurrentNotebookId();
}

// Check for pending import from context menu
async function checkPendingImport() {
    chrome.runtime.sendMessage({ type: "EXTENDLM_GET_PENDING_IMPORT" }, async (pending) => {
        if (pending && pending.content) {
            const notebookId = await getTargetNotebookId();
            if (!notebookId) {
                alert("Please select a notebook first.");
                return;
            }

            if (pending.type === "url") {
                if (confirm(`Add "${pending.title}" to notebook?`)) {
                    const result = await notebookLM.addUrl(notebookId, pending.content);
                    addToHistory(pending.content, result.success);
                }
            }
        }
    });
}

// Batch URL Import
async function handleBatchImport() {
    const textarea = document.getElementById('batch-urls');
    const progressDiv = document.getElementById('batch-progress');
    const urls = textarea.value.split('\n').map(u => u.trim()).filter(u => u.length > 0);

    if (urls.length === 0) {
        alert("Please paste some URLs.");
        return;
    }

    const notebookId = await getTargetNotebookId();
    if (!notebookId) {
        alert("Please select a notebook first.");
        return;
    }

    progressDiv.classList.remove('hidden');
    progressDiv.textContent = `Importing ${urls.length} URLs...`;

    for (let i = 0; i < urls.length; i++) {
        progressDiv.textContent = `Importing ${i + 1}/${urls.length}...`;
        const result = await notebookLM.addUrl(notebookId, urls[i]);
        addToHistory(urls[i], result.success);
        await new Promise(r => setTimeout(r, 1000));
    }

    progressDiv.textContent = "Batch Import Complete!";
    textarea.value = "";
    setTimeout(() => progressDiv.classList.add('hidden'), 3000);
}

// Export Sources to JSON
async function handleExportSources() {
    const notebookId = await getTargetNotebookId();
    if (!notebookId) {
        alert("Please select a notebook first.");
        return;
    }

    const notebooks = await notebookLM.getNotebooks();
    const notebook = notebooks.find(nb => nb.id === notebookId);

    if (!notebook) {
        alert("Could not find notebook.");
        return;
    }

    const exportData = {
        notebookId: notebook.id,
        notebookTitle: notebook.title,
        exportedAt: new Date().toISOString(),
        sources: notebook.sources.map(s => ({
            id: s.id,
            title: s.title,
            url: s.url
        }))
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${notebook.title || 'notebook'}-sources.json`;
    a.click();
    URL.revokeObjectURL(url);
}

// Source Health Check (404 detection)
async function handleHealthCheck() {
    const progressDiv = document.getElementById('health-progress');
    const notebookId = await getTargetNotebookId();

    if (!notebookId) {
        alert("Please select a notebook first.");
        return;
    }

    progressDiv.classList.remove('hidden');
    progressDiv.textContent = "Fetching sources...";

    const notebooks = await notebookLM.getNotebooks();
    const notebook = notebooks.find(nb => nb.id === notebookId);

    if (!notebook || !notebook.sources) {
        progressDiv.textContent = "No sources found.";
        return;
    }

    const urlSources = notebook.sources.filter(s => s.url);
    const brokenUrls = [];

    for (let i = 0; i < urlSources.length; i++) {
        progressDiv.textContent = `Checking ${i + 1}/${urlSources.length}...`;

        try {
            // We can't directly fetch due to CORS, so we use a HEAD request via background
            // For now, we'll just check if the URL is valid format
            new URL(urlSources[i].url);
        } catch (e) {
            brokenUrls.push(urlSources[i]);
        }
    }

    if (brokenUrls.length === 0) {
        progressDiv.textContent = `All ${urlSources.length} sources have valid URLs!`;
    } else {
        progressDiv.textContent = `Found ${brokenUrls.length} sources with invalid URLs.`;
        console.log("Broken URLs:", brokenUrls);
    }

    setTimeout(() => progressDiv.classList.add('hidden'), 5000);
}

// Dark Mode Toggle
function toggleDarkMode() {
    const panel = document.getElementById('extendlm-advanced-features');
    panel.classList.toggle('dark');

    const isDark = panel.classList.contains('dark');
    chrome.storage.local.set({ extendlmDarkMode: isDark });

    document.getElementById('btn-dark-mode').textContent = isDark ? '☀️' : '🌙';
}

// Import History Functions
function addToHistory(url, success) {
    const historyDiv = document.getElementById('import-history');
    const entry = document.createElement('div');
    entry.className = `flex items-center gap-1 ${success ? 'text-green-600' : 'text-red-500'}`;
    entry.innerHTML = `
        <span>${success ? '✓' : '✗'}</span>
        <span class="truncate">${url.length > 40 ? url.substring(0, 40) + '...' : url}</span>
    `;
    historyDiv.insertBefore(entry, historyDiv.firstChild);

    // Also save to storage
    chrome.storage.local.get('extendlmHistory', (data) => {
        const history = data.extendlmHistory || [];
        history.unshift({ url, success, timestamp: Date.now() });
        chrome.storage.local.set({ extendlmHistory: history.slice(0, 50) }); // Keep last 50
    });
}

function loadImportHistory() {
    const historyDiv = document.getElementById('import-history');
    chrome.storage.local.get('extendlmHistory', (data) => {
        const history = data.extendlmHistory || [];
        if (history.length === 0) {
            historyDiv.innerHTML = '<div class="text-slate-400 italic">No imports yet</div>';
            return;
        }

        historyDiv.innerHTML = '';
        history.slice(0, 10).forEach(item => {
            const entry = document.createElement('div');
            entry.className = `flex items-center gap-1 ${item.success ? 'text-green-600' : 'text-red-500'}`;
            entry.innerHTML = `
                <span>${item.success ? '✓' : '✗'}</span>
                <span class="truncate">${item.url.length > 40 ? item.url.substring(0, 40) + '...' : item.url}</span>
            `;
            historyDiv.appendChild(entry);
        });
    });
}

function clearImportHistory() {
    chrome.storage.local.remove('extendlmHistory', () => {
        document.getElementById('import-history').innerHTML = '<div class="text-slate-400 italic">No imports yet</div>';
    });
}

// ============== NEW FEATURE HANDLERS ==============

// Create a new notebook
async function handleCreateNotebook() {
    const input = document.getElementById('new-notebook-title');
    const title = input.value.trim();
    if (!title) {
        alert("Please enter a notebook title.");
        return;
    }

    const result = await notebookLM.createNotebook(title);
    if (result.success) {
        input.value = "";
        alert(`Notebook "${title}" created!`);
        await loadNotebookSelector();
    } else {
        alert("Failed to create notebook: " + result.error);
    }
}

// Bookmarks toggle - load folders
async function handleBookmarksToggle() {
    const container = document.getElementById('bookmarks-container');
    container.classList.toggle('hidden');
    
    if (container.classList.contains('hidden')) return;
    
    const selector = document.getElementById('bookmark-folder');
    selector.innerHTML = '<option value="">Loading folders...</option>';
    
    try {
        const tree = await chrome.bookmarks.getTree();
        const folders = [];
        
        function processNode(node) {
            if (node.children) {
                if (node.id !== "0") { // Skip root
                   folders.push({ id: node.id, title: node.title || "Bookmarks Bar" });
                }
                node.children.forEach(processNode);
            }
        }
        
        tree.forEach(processNode);
        
        selector.innerHTML = '<option value="">Select a folder...</option>';
        folders.forEach(f => {
            const opt = document.createElement('option');
            opt.value = f.id;
            opt.textContent = f.title;
            selector.appendChild(opt);
        });
    } catch (e) {
        console.error("Bookmarks Error:", e);
        selector.innerHTML = '<option value="">Error loading bookmarks</option>';
    }
}

// Import all links from a bookmark folder
async function handleBookmarksImport() {
    const folderId = document.getElementById('bookmark-folder').value;
    if (!folderId) {
        alert("Please select a folder.");
        return;
    }
    
    const notebookId = await getTargetNotebookId();
    if (!notebookId) {
        alert("Please select a target notebook.");
        return;
    }
    
    const bookmarks = await chrome.bookmarks.getChildren(folderId);
    const links = bookmarks.filter(b => b.url).map(b => b.url);
    
    if (links.length === 0) {
        alert("No bookmarks with URLs found in this folder.");
        return;
    }
    
    if (!confirm(`Import ${links.length} bookmarks to NotebookLM?`)) return;
    
    const progressDiv = document.getElementById('batch-progress');
    progressDiv.classList.remove('hidden');
    
    for (let i = 0; i < links.length; i++) {
        progressDiv.textContent = `Importing Bookmark ${i + 1}/${links.length}...`;
        const result = await notebookLM.addUrl(notebookId, links[i]);
        addToHistory(links[i], result.success);
        await new Promise(r => setTimeout(r, 1000));
    }
    
    progressDiv.textContent = "Bookmarks Import Complete!";
    setTimeout(() => progressDiv.classList.add('hidden'), 3000);
}

// Webpage Selector Import
async function handlePageSelector() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;
    
    const notebookId = await getTargetNotebookId();
    if (!notebookId) {
        alert("Please select a target notebook.");
        return;
    }

    alert("Selector Mode: Click any element on the page to import all links within it.");

    await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
            const overlay = document.createElement('div');
            overlay.id = 'extendlm-selector-overlay';
            overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:999999;cursor:crosshair;background:rgba(0,0,0,0.1);';
            document.body.appendChild(overlay);
            
            let hoveredElement = null;
            
            const onMouseMove = (e) => {
                overlay.style.pointerEvents = 'none';
                const el = document.elementFromPoint(e.clientX, e.clientY);
                overlay.style.pointerEvents = 'auto';
                
                if (el !== hoveredElement && el !== overlay) {
                    if (hoveredElement) hoveredElement.style.outline = '';
                    hoveredElement = el;
                    if (hoveredElement) hoveredElement.style.outline = '2px dashed #3b82f6';
                }
            };
            
            const onClick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                if (hoveredElement) {
                    const anchors = Array.from(hoveredElement.querySelectorAll('a'));
                    const urls = anchors.map(a => a.href).filter(h => h.startsWith('http'));
                    
                    chrome.runtime.sendMessage({
                        type: 'EXTENDLM_SELECTOR_RESULT',
                        urls: Array.from(new Set(urls))
                    });
                    
                    hoveredElement.style.outline = '';
                }
                
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('click', onClick, true);
                overlay.remove();
            };
            
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('click', onClick, true);
        }
    });
}

// Listener for selector results
chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'EXTENDLM_SELECTOR_RESULT') {
        const urls = message.urls;
        if (urls.length === 0) {
            alert("No links found in selected element.");
            return;
        }
        
        if (confirm(`Found ${urls.length} links. Import all?`)) {
            const textarea = document.getElementById('batch-urls');
            textarea.value = urls.join('\n');
            document.getElementById('batch-input-container').classList.remove('hidden');
            handleBatchImport();
        }
    }
});

// Bulk Rename Apply
async function handleBulkRenameApply() {
    const prefix = document.getElementById('rename-prefix').value.trim();
    const suffix = document.getElementById('rename-suffix').value.trim();
    
    if (!prefix && !suffix) {
        alert("Please provide at least a prefix or suffix.");
        return;
    }
    
    const notebookId = await getTargetNotebookId();
    if (!notebookId) {
        alert("Please select a target notebook.");
        return;
    }
    
    const notebooks = await notebookLM.getNotebooks();
    const notebook = notebooks.find(nb => nb.id === notebookId);
    
    if (!notebook || !notebook.sources) {
        alert("No sources found to rename.");
        return;
    }
    
    if (!confirm(`Rename all ${notebook.sources.length} sources?`)) return;
    
    const progressDiv = document.getElementById('batch-progress');
    progressDiv.classList.remove('hidden');
    
    for (let i = 0; i < notebook.sources.length; i++) {
        const src = notebook.sources[i];
        const newName = `${prefix}${src.title}${suffix}`;
        progressDiv.textContent = `Renaming ${i + 1}/${notebook.sources.length}: ${newName}`;
        
        await notebookLM.renameSource(notebookId, src.id, newName);
        await new Promise(r => setTimeout(r, 800));
    }
    
    progressDiv.textContent = "Bulk Rename Complete!";
    document.getElementById('rename-input-container').classList.add('hidden');
    setTimeout(() => progressDiv.classList.add('hidden'), 3000);
    
    // Refresh selector to update titles if cached
    await loadNotebookSelector();
}


