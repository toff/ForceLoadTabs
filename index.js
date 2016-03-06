// Force load tab
//
// With inspiration from :
// - https://github.com/gialloporpora/newtabintabcontextmenu
//

// jpm run -p ~/.mozilla/firefox/dev --no-copy -b /usr/bin/firefox --binary-args -jsconsole
// jpm run -p dev --no-copy -b /usr/bin/firefox --binary-args -jsconsole

"use strict";

// Turn log on for this addon
let self = require("sdk/self");
/**
// extensions.@forceloadtabs.sdk.console.logLevel = "all"
let keyName = 'extensions.' + self.id + '.sdk.console.logLevel';
require("sdk/preferences/service").set(keyName, 'all');
/**/

// For localization
let _ = require("sdk/l10n").get;

// For chrome <-> addon-sdk conversion
let { modelFor } = require("sdk/model/core");
let { viewFor } = require("sdk/view/core");

// To store the forced tab id between restart.
let simpleStorage = require("sdk/simple-storage").storage;

let tabs = require("sdk/tabs");

let tabIdsToReload = [];
let tabIdsBeingReloaded = [];
// Funciton to load tabs one by one to be nice on resource
function scheduledReload(newLoadedTab) {
	
	// TODO : check addonsdk threading model (is this thread safe?)
	
	if (typeof newLoadedTab !== 'undefined') {
		let index = tabIdsBeingReloaded.indexOf(newLoadedTab.id);
		if (index == -1) {
			// not a tab being reloaded by us
			console.log('scheduledReload: ignoring tab:', newLoadedTab.id);
			return;
		}
		tabIdsBeingReloaded.splice(index, 1);
	}
	while (tabIdsToReload.length > 0 && tabIdsBeingReloaded.length < 1) {
		let tabId = tabIdsToReload.shift();
		let tabToReload = getTabById(tabId);
		if (typeof tabToReload !== 'undefined') {
			tabIdsBeingReloaded.push(tabId);
			console.log('scheduledReload: reloading:', tabId);
			tabToReload.reload();
		} else {
			console.log('scheduledReload: tab was closed before reload:', tabId);
		}
	}
}

// Addon startup, check stored data.
if (!simpleStorage.forcedtabs) {
    console.log("startup storage: init with empty object.");
    simpleStorage.forcedtabs = {};
} else {
	
	// TODO : check prefs ?
	// "Don't load tabs until selected" : browser.sessionstore.restore_on_demand == true
	// "When Firefox starts: Show my windows and tabs from last time" :  browser.startup.page == 3
	
    console.log("startup storage:", simpleStorage.forcedtabs);
    
    // Build scheduled reload list and clean closed tab from storage.
    var forcedtabsMissing = Object.assign({}, simpleStorage.forcedtabs);
    for (let tab of tabs) {
        if (simpleStorage.forcedtabs[tab.id] === true && tab.readyState === 'interactive') {
            console.log("startup scheduled reload:", tab.id, ", readyState:", tab.readyState);
            tabIdsToReload.push(tab.id);
        } else {
			console.log("startup not reloading:", tab.id, ", readyState:", tab.readyState,
				", title:", tab.title, ", url:", tab.url, ", contentType:", tab.contentType,
				', index:', tab.index);
		}
        delete forcedtabsMissing[tab.id];
    }
    for (let tabId in forcedtabsMissing) {
		console.log("startup removing missing tab:", tabId);
		delete simpleStorage.forcedtabs[tabId];
	}
	
	// Do the scheduled reload.
	if (tabIdsToReload.length > 0) {
		tabs.on('load', function onLoad(tab) {
			console.log('tab onLoad:', tab.id);
			scheduledReload(tab);
			
			if (tabIdsBeingReloaded.length == 0 && tabIdsToReload.length == 0) {
				console.log('tab onLoad:', tab.id, ", listener removed.");
				tabs.removeListener("load", onLoad);
			}
		});
		scheduledReload();
	}
}

// Install tab context menu on existing windows and on new windows
let windows = require("sdk/windows");
for (let window of windows.browserWindows) {
  installTabContextMenu(window);
}
windows.browserWindows.on("open", installTabContextMenu);

function installTabContextMenu(browserWindow) {
	console.log("installTabContextMenu on window:", browserWindow.title);
    let chromeWindow = viewFor(browserWindow);
    let tabContextMenu = chromeWindow.document.getElementById("tabContextMenu");
    let forceLoadMenuItem = chromeWindow.document.createElementNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul","menuitem");
    forceLoadMenuItem.setAttribute("id", "contexttab-forceloadtab");
    forceLoadMenuItem.setAttribute("label", _("forceLoadTabMenuLabel"));
    forceLoadMenuItem.setAttribute("accesskey", _("forceLoadTabMenuAccessKey"));
    forceLoadMenuItem.setAttribute("checked", "false");
    
    // "Force load tab" menu item action
    forceLoadMenuItem.addEventListener("command", 
		function (event) {
			//console.log("command", event);
			//console.log("command", tabContextMenu.triggerNode);
			
			let chromeTab = tabContextMenu.triggerNode;
			let selectedTab = modelFor(chromeTab);
			if (typeof selectedTab === 'undefined') {
				// Fall back to active tab
				selectedTab = tabs.activeTab;
			}
			
			let checkedStatus = this.getAttribute("checked");
			let newStatus = (checkedStatus == "false" ? "true" : "false"); 
			this.setAttribute("checked", newStatus);
			

			console.log("oncommand selectedTab:", selectedTab.id, ", title:", selectedTab.title, ", readyState:", selectedTab.readyState);
			
			if (newStatus == "true") {
				// Add tab id to storage
				console.log("oncommand Adding tab with id:", selectedTab.id);
				simpleStorage.forcedtabs[selectedTab.id] = true;
			} else {
				console.log("oncommand Removing tab with id:", selectedTab.id);
				delete simpleStorage.forcedtabs[selectedTab.id];
			}
			
			return true;
		},
		false
	);
    
    // Update tab context menu on popup
    tabContextMenu.addEventListener("popupshowing",
        function (event) {
			//console.log("popupshowing", event);
			
			let chromeTab = event.target.triggerNode;
			let selectedTab = modelFor(chromeTab);
			if (typeof selectedTab === 'undefined') {
				console.log("popupshowing fall back to active tab.");
				// Fall back to active tab
				selectedTab = tabs.activeTab;
				forceLoadMenuItem.setAttribute("label", _("forceLoadTabActiveMenuLabel"));
			}
			
            // Update context menu to match the selected tab state
            let isChecked = (simpleStorage.forcedtabs[selectedTab.id] === true);
            console.log("popupshowing selectedTab:", selectedTab.id, ", readyState:", selectedTab.readyState, ", isChecked:", isChecked);
            forceLoadMenuItem.setAttribute("checked", isChecked ? "true" : "false");
        },
        false
    );

    tabContextMenu.insertBefore(forceLoadMenuItem, tabContextMenu.lastChild);
}

// Listen for tab closing.
//tabs.on('close', function onClose(tab) {
    // TODO : unfortunately we don't know the reason for closing the tab, so we can't use this
    //console.log("tabclose: removing tab with id:", tab.id);
    // delete simpleStorage.forcedtabs[tab.id];
//});

// Cleanup on unload addon

exports.onUnload = function(reason) {
	console.log("onUnload reason:", reason, ", storage:", simpleStorage.forcedtabs);
	for (let window of windows.browserWindows) {
	  removeTabContextMenu(window);
	}
}

function removeTabContextMenu(browserWindow) {
	console.log("removeTabContextMenu on window:", browserWindow.title);
    let chromeWindow = viewFor(browserWindow);
    let tabContextMenu = chromeWindow.document.getElementById("tabContextMenu");
    let forceLoadMenuItem = chromeWindow.document.getElementById("contexttab-forceloadtab");
    tabContextMenu.removeChild(forceLoadMenuItem)
}


function getTabById(id) {
    for (let tab of tabs) {
        if (tab.id == id) {
            return tab;
        }
    }
}


// Listen for tabs event.
/*
tabs.on('*', function on(event, arg1, arg2) {
    console.log('tab on:', event, " | ", arg1.id, " | ", arg1.readyState, " | ", arg2);
});
*/

