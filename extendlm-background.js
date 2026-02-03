/**
 * ExtendLM Background Script
 * Handles context menus, keyboard commands, and extended features.
 */

// ============== CONTEXT MENU ==============
chrome.runtime.onInstalled.addListener(() => {
    // Create context menu for links
    chrome.contextMenus.create({
        id: "extendlm-add-link",
        title: "Add Link to NotebookLM",
        contexts: ["link"]
    });

    // Create context menu for page
    chrome.contextMenus.create({
        id: "extendlm-add-page",
        title: "Add This Page to NotebookLM",
        contexts: ["page"]
    });

    // Create context menu for selected text
    chrome.contextMenus.create({
        id: "extendlm-add-selection",
        title: "Add Selection to NotebookLM",
        contexts: ["selection"]
    });

    console.log("ExtendLM context menus created.");
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener((info, tab) => {
    let urlToAdd = null;
    let textToAdd = null;

    if (info.menuItemId === "extendlm-add-link") {
        urlToAdd = info.linkUrl;
    } else if (info.menuItemId === "extendlm-add-page") {
        urlToAdd = info.pageUrl;
    } else if (info.menuItemId === "extendlm-add-selection") {
        textToAdd = info.selectionText;
    }

    if (urlToAdd || textToAdd) {
        // Store in local storage for the side panel to pick up
        chrome.storage.local.set({
            pendingImport: {
                type: urlToAdd ? "url" : "text",
                content: urlToAdd || textToAdd,
                title: tab?.title || "Untitled",
                timestamp: Date.now()
            }
        }, () => {
            // Open the side panel
            chrome.sidePanel.open({ windowId: tab.windowId });
        });
    }
});

// ============== KEYBOARD COMMANDS ==============
chrome.commands.onCommand.addListener(async (command) => {
    if (command === "add-current-page") {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab && tab.url) {
            chrome.storage.local.set({
                pendingImport: {
                    type: "url",
                    content: tab.url,
                    title: tab.title || "Untitled",
                    timestamp: Date.now()
                }
            }, () => {
                chrome.sidePanel.open({ windowId: tab.windowId });
            });
        }
    } else if (command === "open-side-panel") {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab) {
            chrome.sidePanel.open({ windowId: tab.windowId });
        }
    }
});

// ============== MESSAGE LISTENER ==============
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "EXTENDLM_GET_PENDING_IMPORT") {
        chrome.storage.local.get("pendingImport", (data) => {
            sendResponse(data.pendingImport || null);
            // Clear after reading
            chrome.storage.local.remove("pendingImport");
        });
        return true; // async response
    }

    if (message.type === "EXTENDLM_OPEN_SIDE_PANEL") {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]) {
                chrome.sidePanel.open({ windowId: tabs[0].windowId });
            }
        });
        sendResponse({ success: true });
        return true;
    }
});

console.log("ExtendLM Background Script Loaded.");
