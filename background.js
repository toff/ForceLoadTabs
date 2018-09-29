// ForceLoadTabs
//
// To develop this addon use a development version of firefox with "xpinstall.signatures.required = false"
// $ web-ext build --overwrite-dest
// This will create : "./web-ext-artifacts/forceloadtabs-X.X.X.zip"
// In the "Add-ons Manager" > "Install Add-on From File ..."
//
// Permissions:
// - sessions: used to store the "forceload" flag associated to each tab.
// - menus: used to add the context menu entry.
// - tabs: used to load tabs on startup.
//
// 
// This addon uses some ES6 constructs :
// Support loading background scripts as ES6 modules
// https://bugzilla.mozilla.org/show_bug.cgi?id=1394303
//

const FORCE_LOAD_TABS_NAME = 'ForceLoadTabs';
const FORCE_LOAD_TAB_KEY = 'forceload';
const FORCE_LOAD_TAB_ENABLED_VALUE = 'true';
const FORCE_LOAD_TABS_MENU_ID = 'forceloadtabs';

// --------------------------------------------------------------------------
// Utilities
// --------------------------------------------------------------------------

function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// -----

class Logger {

    constructor(prefix) {
        this.prefix = prefix;
    }

    debug(context, msg = '', obj = '') {
        const now = new Date();
        const dateStr = now.toLocaleTimeString('en-GB') + '.' + String(now.getMilliseconds()).padStart(3, '0');
        console.debug(`${dateStr} ${this.prefix}::${context}> ${msg}`, obj);
    }

}

class NullLogger {
    debug() {}
}

const debug = true; // TODO : make this configurable
const LOGGER = debug ? new Logger("FLT") : new NullLogger();

// -----

class Watchdog {

    constructor(callback, delay) {
        this.callback = () => {
            this.triggered = true;
            callback();
        };
        this.delay = delay;
        this.timerID = undefined;
        this.triggered = false;
    }
    
    reset() {
        window.clearTimeout(this.timerID);
        if (!this.triggered) {
            this.timerID = window.setTimeout(this.callback, this.delay);
        }
    }
}

// --------------------------------------------------------------------------

class TabsReloader {

    constructor(concurrentCount = 1, delay = 1000, timeout = 3000) {
        this.concurrentCount = concurrentCount; // Concurrent reload count.
        this.delay = delay; // Delay between reload.
        this.timeout = timeout; // Tab reload timeout.
        
        this.tabIdsToReload = []; // List of forced tab ids to reload.
        this.tabIdsCompleted = []; // List of all completed tab ids during startup, even not forced one.
        
        this.pendingTabIdsToReload = [];
        this.completedTabLeftToReload = 0;
        this.completedPromiseResolve = () => {};
        this.reloading = false;
    }


    addTab(tabId) {
        if (!this.tabIdsToReload.includes(tabId)) {
            LOGGER.debug('TabsReloader::addTab',`Adding tab #${tabId} to tabIdsToReload.`);
            this.tabIdsToReload.push(tabId);
        }
    }
    
    completedTab(tabId) {
        // Notice that this will be called by the tab update listener even before doReloads().
        
        if (!this.tabIdsCompleted.includes(tabId)) {
            this.tabIdsCompleted.push(tabId);
                       
            LOGGER.debug('TabsReloader::completedTab', `Completed tab #${tabId} pendingTabIdsToReload = [${this.pendingTabIdsToReload}], reloading = ${this.reloading}.`);
            
            if (this.reloading) {
                this.completedTabLeftToReload--;
                
                // Reload another tab.
                const nextTabIdToReload = this.pendingTabIdsToReload.shift();
                if (nextTabIdToReload !== undefined) {
                    wait(this.delay).then( () => {
                        this.reloadTab(nextTabIdToReload);
                    });
                } else if (this.completedTabLeftToReload <= 0) {
                    LOGGER.debug('TabsReloader::completedTab', `All tabs reloaded.`);
                    this.reloading = false;
                    this.completedPromiseResolve();
                }
            }
        }
    }
    
    doReloads() {
        this.pendingTabIdsToReload = this.tabIdsToReload.filter( tabId => !this.tabIdsCompleted.includes(tabId) );
        this.completedTabLeftToReload = this.pendingTabIdsToReload.length;

        if (this.pendingTabIdsToReload.length > 0) {
            this.reloading = true;
            const completedPromise = new Promise((resolve, reject) => {
                this.completedPromiseResolve = resolve;
            });
            LOGGER.debug('TabsReloader::doReloads', `pendingTabIdsToReload = [${this.pendingTabIdsToReload}].`);
            
            for (let i = 0; i < this.concurrentCount; i++) {
                this.reloadTab(this.pendingTabIdsToReload.shift());
            }
            return completedPromise;
        }
        return Promise.resolve();
    }
    
    reloadTab(tabId) {
        LOGGER.debug('TabsReloader::reloadTab', `Forcing tab #${tabId} to reload.`);
        
        browser.tabs.reload(tabId).then( () => {
            LOGGER.debug('TabsReloader::reloadTab', `Tab #${tabId} is reloading.`);
        });
        // Set reload as completed after a timeout.
        // No need to cancel it on real completion, it will be ignored if is already completed.
        wait(this.timeout).then( () => {
            LOGGER.debug('TabsReloader::reloadTab', `Tab #${tabId} reloading timeout (ignore if reload completed).`);
            this.completedTab(tabId);
        });
    }
    
}



// --------------------------------------------------------------------------
// Context menu handling
// --------------------------------------------------------------------------

function onContextMenuClick(info, tab) {
    let tabId = tab.id;
    LOGGER.debug('onContextMenuClick',`Tab #${tabId} checked = ${info.checked}.`);
    if (info.checked) {
        LOGGER.debug('onContextMenuClick',`Set forceload on tab #${tabId}.`);
        browser.sessions.setTabValue(tabId, FORCE_LOAD_TAB_KEY, FORCE_LOAD_TAB_ENABLED_VALUE);
    } else {
        LOGGER.debug('onContextMenuClick',`Remove forceload on tab #${tabId}.`);
        browser.sessions.removeTabValue(tabId, FORCE_LOAD_TAB_KEY);
    }
}

const FLTMenu = {
    id: FORCE_LOAD_TABS_MENU_ID,
    title: 'Force load tab',
    type: 'checkbox',
    contexts: ['tab'],
    onclick: onContextMenuClick
};
browser.menus.create(FLTMenu);

function updateContextMenu(tabId) {
    browser.sessions.getTabValue(tabId, FORCE_LOAD_TAB_KEY).then((forceload) => {
        LOGGER.debug('updateContextMenu',`Tab #${tabId} was activated. "${FORCE_LOAD_TAB_KEY}" = ${forceload}.`);
        browser.menus.update(FORCE_LOAD_TABS_MENU_ID, {
            checked: (forceload === FORCE_LOAD_TAB_ENABLED_VALUE)
        });
        browser.menus.refresh();
    });
}

browser.menus.onShown.addListener(async function(info, tab) {
    updateContextMenu(tab.id);
});

// -----
// For TreeStyleTab compatibility:
// https://github.com/piroor/treestyletab
// https://github.com/piroor/treestyletab/wiki/API-for-other-addons
// -----

const FLTMenuForTST = {
    id: FORCE_LOAD_TABS_MENU_ID,
    title: 'Force load tab',
    type: 'checkbox',
    contexts: ['tab'],
    // onclick: onContextMenuClick // NOT SUPPORTED
};

const kTST_ID = 'treestyletab@piro.sakura.ne.jp';
async function registerToTST() {
    LOGGER.debug('registerToTST',`Begin.`);
  
    try {
        const success = await browser.runtime.sendMessage(kTST_ID, {
            type: 'register-self',
            name: FORCE_LOAD_TABS_MENU_ID,
            listeningTypes: ['ready', 'fake-contextMenu-shown']
        });
        if (success) {
            LOGGER.debug('registerToTST',`Register successful.`);
            await browser.runtime.sendMessage(kTST_ID, {
                type: 'fake-contextMenu-create',
                params: FLTMenuForTST
            });
        }
    } catch (error) {
        LOGGER.debug('registerToTST',`TST is not available.`, error);
    }
}

browser.runtime.onMessageExternal.addListener((aMessage, aSender, sendResponse) => {
    if (aSender.id === kTST_ID) {
        LOGGER.debug('onMessageExternal',`treestyletab aMessage=`, aMessage);
        switch (aMessage.type) {
        case 'ready':
            registerToTST(); // passive registration for secondary (or after) startup
            sendResponse(true);
            break;
        case 'fake-contextMenu-click':
            onContextMenuClick(aMessage.info, aMessage.tab);
            break;
        case 'fake-contextMenu-shown':
            browser.sessions.getTabValue(aMessage.tab.id, FORCE_LOAD_TAB_KEY).then((forceload) => {
                LOGGER.debug('onMessageExternal::fake-contextMenu-shown',
                    `Tab #${aMessage.tab.id} was activated. "${FORCE_LOAD_TAB_KEY}" = ${forceload}`);
                browser.runtime.sendMessage(kTST_ID, {
                  type: 'fake-contextMenu-update',
                  params: [ FORCE_LOAD_TABS_MENU_ID,
                            { checked: (forceload === FORCE_LOAD_TAB_ENABLED_VALUE) }
                  ]
                }).catch(error => {
                    LOGGER.debug('onMessageExternal::fake-contextMenu-shown',`TST NA.`, error);
                });
            });
            break;
        }
    }
});
registerToTST(); // aggressive registration on initial installation


// --------------------------------------------------------------------------
// Startup
// --------------------------------------------------------------------------

function handleStartup() {
    LOGGER.debug('handleStartup',`Begin.`);
    
    browser.tabs.query({}).then(async (tabs) => {
        LOGGER.debug('handleStartup',`Query all tabs result => tabIds:`, tabs.map(tab => tab.id));
        
        for (let tab of tabs) {
            let tabId = tab.id;
            
            const forceLoad = await browser.sessions.getTabValue(tabId, FORCE_LOAD_TAB_KEY);
            if (forceLoad !== FORCE_LOAD_TAB_ENABLED_VALUE) {
                // Not forced for this tab
                continue;
            }
            
            tabsReloader.addTab(tabId);
        }
        
        tabsReloader.doReloads().then(() => cleanup() );
        
        LOGGER.debug('handleStartup',`Done.`);
    });
}


function handleTabUpdated(tabId, changeInfo, tabInfo) {
    sessionRestoreFinishedWatchdog.reset();
    
    if (changeInfo.hasOwnProperty('status') && changeInfo.status === 'complete') {
        tabsReloader.completedTab(tabId);
    }
}
browser.tabs.onUpdated.addListener(handleTabUpdated);


function cleanup() {
    LOGGER.debug('cleanup',`Cleaning up.`);
    browser.tabs.onUpdated.removeListener(handleTabUpdated);
    
    tabsReloader = undefined;
    sessionRestoreFinishedWatchdog = undefined;
}


let sessionRestoreFinishedWatchdog = new Watchdog(firefoxSessionRestoreFinished, /* timeout */ 2000);
let tabsReloader = new TabsReloader(
    1,   // Tab reload concurrency.
    500, // Delay between reloads.
    3000 // Tab reload timeout.
);


// -----------------------
// Firefox is currently missing an event to know when session data are restored.
// The following are called too early:
// 1) browser.runtime.onStartup
// 2) document.addEventListener('DOMContentLoaded', ...
//
// So we use a watchdog that is reset each time a tab is updated.
//
// Bugs to monitor:
// https://bugzilla.mozilla.org/show_bug.cgi?id=1413263 : Implement sessions.onRestore
//

document.addEventListener('DOMContentLoaded', (e) => {
    LOGGER.debug('DOMContentLoaded');
    //handleStartup();
});

browser.runtime.onStartup.addListener(() => {
    LOGGER.debug('onStartup');
    //handleStartup();
});

LOGGER.debug('Watchdog', `Arming session restore watchdog.`);
sessionRestoreFinishedWatchdog.reset();

function firefoxSessionRestoreFinished() {
    LOGGER.debug('firefoxSessionRestoreFinished');
    handleStartup();
}


