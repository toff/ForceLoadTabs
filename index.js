/* jshint moz: true, browser: true, devel: true, undef: true, curly: true */
/* globals require, exports */

//
// Force load tabs
// christophe.paris@gmail.com
//
// With inspiration from :
// - https://github.com/gialloporpora/newtabintabcontextmenu
// - https://developer.mozilla.org/en-US/docs/Session_store_API
// - https://developer.mozilla.org/en-US/docs/Mozilla/Tech/XUL/tab
//

// firefox -P dev -jsconsole


(function(){
"use strict";

// Turn log on for this addon
let self = require("sdk/self");
/**
// extensions.@forceloadtabs.sdk.console.logLevel = "all"

let keyName = "extensions." + self.id + ".sdk.console.logLevel";
require("sdk/preferences/service").set(keyName, "all");
/**/

// For localization
let _ = require("sdk/l10n").get;

// For chrome <-> addon-sdk conversion
let { modelFor } = require("sdk/model/core");
let { viewFor } = require("sdk/view/core");

// To access session store
var { Cc, Ci } = require("chrome");
var sessionStore = Cc["@mozilla.org/browser/sessionstore;1"].getService(Ci.nsISessionStore);

// The "force load" tab flag key used in the session store 
const FORCE_LOAD_KEY = "forceLoad";

let tabs = require("sdk/tabs");

let tabIdsToReload = [];
let tabIdsBeingReloaded = [];
// Function to load tabs one by one to be nicer on resource
function scheduledReload(newLoadedTab) {
    
    // TODO : check addonsdk threading model (is this thread safe?)
    
    if (typeof newLoadedTab !== "undefined") {
        let index = tabIdsBeingReloaded.indexOf(newLoadedTab.id);
        if (index === -1) {
            // Not a tab being reloaded by us
            console.log("scheduledReload: ignoring tab:", newLoadedTab.id);
            return;
        }
        tabIdsBeingReloaded.splice(index, 1);
    }
    while (tabIdsToReload.length > 0 && tabIdsBeingReloaded.length < 1) {
        let tabId = tabIdsToReload.shift();
        let tabToReload = getTabById(tabId);
        if (typeof tabToReload !== "undefined") {
            tabIdsBeingReloaded.push(tabId);
            console.log("scheduledReload: reloading:", tabId, ', title:', tabToReload.title);
            tabToReload.reload();
        } else {
            console.log("scheduledReload: tab was closed before reload:", tabId);
        }
    }
}

// Addon startup, check stored data.
{
    // TODO : check prefs ?
    // Those prefs need to be set for this addon.
    // "Don't load tabs until selected" : browser.sessionstore.restore_on_demand == true
    // "When Firefox starts: Show my windows and tabs from last time" :  browser.startup.page == 3
    
    console.log("startup");
    
    // Build scheduled reload list
    for (let tab of tabs) {
        let chromeTab = viewFor(tab);
        let forceLoad = (sessionStore.getTabValue(chromeTab, FORCE_LOAD_KEY) === "true");
        
        if (forceLoad === true && chromeTab.hasAttribute("pending")) {
            console.log("startup scheduled reload:", tab.id, ", readyState:", tab.readyState,
                ", pending:", chromeTab.hasAttribute("pending"));
            tabIdsToReload.push(tab.id);
        } else {
            console.log("startup not reloading:", tab.id, ", readyState:", tab.readyState,
                ", title:", tab.title, ", url:", tab.url, ", contentType:", tab.contentType,
                ", index:", tab.index, ", pending: ",  chromeTab.hasAttribute("pending"));
        }
    }
    
    // Do the scheduled reload.
    if (tabIdsToReload.length > 0) {
        tabs.on("load", function onLoad(tab) {
            console.log("tab onLoad:", tab.id);
            scheduledReload(tab);
            // If no more tab to reload, remove "load" listener.
            if (tabIdsBeingReloaded.length === 0 && tabIdsToReload.length === 0) {
                console.log("tab onLoad:", tab.id, ", listener removed.");
                tabs.removeListener("load", onLoad);
            }
        });
        scheduledReload();
    }
}

// Install tab context menu item on existing windows and on new windows
let windows = require("sdk/windows");
for (let window of windows.browserWindows) {
  installTabContextMenuItem(window);
}
windows.browserWindows.on("open", installTabContextMenuItem);

function installTabContextMenuItem(browserWindow) {
    console.log("installTabContextMenuItem on window:", browserWindow.title);
    let chromeWindow = viewFor(browserWindow);
    let tabContextMenu = chromeWindow.document.getElementById("tabContextMenu");
    let forceLoadMenuItem = chromeWindow.document.createElementNS(
        "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul","menuitem");
    forceLoadMenuItem.setAttribute("id", "contexttab-forceloadtab");
    forceLoadMenuItem.setAttribute("label", _("forceLoadTabMenuLabel"));
    forceLoadMenuItem.setAttribute("accesskey", _("forceLoadTabMenuAccessKey"));
    forceLoadMenuItem.setAttribute("checked", "false");
    
    // "Force load tab" menu item action
    forceLoadMenuItem.addEventListener("command", 
        function (event) {
            let chromeTab = tabContextMenu.triggerNode;
            let selectedTab = modelFor(chromeTab);
            
            let checkedStatus = sessionStore.getTabValue(chromeTab, FORCE_LOAD_KEY);
            let newStatus = (checkedStatus === "true" ? "false" : "true"); 
            this.setAttribute("checked", newStatus);

            console.log("oncommand selectedTab:", selectedTab.id, ", title:", selectedTab.title,
                ", readyState:", selectedTab.readyState);
            
            if (newStatus === "true") {
                console.log("oncommand Adding tab with id:", selectedTab.id);
                sessionStore.setTabValue(chromeTab, FORCE_LOAD_KEY, "true");
            } else {
                console.log("oncommand Removing tab with id:", selectedTab.id);
                sessionStore.deleteTabValue(chromeTab, FORCE_LOAD_KEY);
            }
            
            return true;
        },
        false
    );
    
    // Update tab context menu on popup
    tabContextMenu.addEventListener("popupshowing",
        function (event) {
            let chromeTab = event.target.triggerNode;
            let selectedTab = modelFor(chromeTab);
            let isChecked = sessionStore.getTabValue(chromeTab, FORCE_LOAD_KEY) === "true";
            console.log("popupshowing selectedTab:", selectedTab.id, ", readyState:",
                selectedTab.readyState, ", isChecked:", isChecked);
            forceLoadMenuItem.setAttribute("checked", isChecked ? "true" : "false");
        },
        false
    );

    tabContextMenu.appendChild(forceLoadMenuItem);
}

// Listen for tab closing.
//tabs.on("close", function onClose(tab) {
    // TODO : unfortunately we don't know the reason for closing the tab, so we can't use this
    //console.log("tabclose: removing tab with id:", tab.id);
    // delete simpleStorage.forcedtabs[tab.id];
//});

// Cleanup on unload addon

exports.onUnload = function(reason) {
    console.log("onUnload reason:", reason);
    if (reason === "uninstall") {
        // Unfortunalety, at the time of writing, reason is never "uninstall".
        resetAllForcedTabs();
    }
    // Remove our tab context menu item.
    for (let window of windows.browserWindows) {
        console.log("remove tab context menu item on window:", window.title);
        let chromeWindow = viewFor(window);
        let tabContextMenu = chromeWindow.document.getElementById("tabContextMenu");
        let forceLoadMenuItem = chromeWindow.document.getElementById("contexttab-forceloadtab");
        tabContextMenu.removeChild(forceLoadMenuItem);
    }
};

function resetAllForcedTabs() {
    // Clean session store "forceLoad" attribute.
    for (let tab of tabs) {
        let chromeTab = viewFor(tab);
        sessionStore.deleteTabValue(chromeTab, FORCE_LOAD_KEY);
    }
}

let simplePrefs = require("sdk/simple-prefs");
simplePrefs.on("resetButton", function() {
  console.log("buttonReset");
  resetAllForcedTabs();
});


function getTabById(id) {
    for (let tab of tabs) {
        if (tab.id == id) {
            return tab;
        }
    }
}


})(); // end "use strict" function form
