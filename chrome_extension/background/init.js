// since version 2.0 the extension is using a keyRing instead of a single key-name-pair
// keepass.convertKeyToKeyRing();
// load settings
page.initSettings();
// create tab information structure for every opened tab
page.initOpenedTabs();
// initial connection with KeePassHttp
// keepass.getDatabaseHash(null);
// set initial tab-ID
chrome.tabs.query({"active": true, "windowId": chrome.windows.WINDOW_ID_CURRENT}, function(tabs) {
	if (tabs.length === 0)
		return; // For example: only the background devtools or a popup are opened
	page.currentTabId = tabs[0].id;
});
// Milliseconds for intervall (e.g. to update browserAction)
var _interval = 250;
// Milliseconds for intervall to check for new input fields
var _intervalCheckForNewInputs = 500;


/**
 * Generate information structure for created tab and invoke all needed
 * functions if tab is created in foreground
 * @param {object} tab
 */
chrome.tabs.onCreated.addListener(function(tab) {
	if(tab.id > 0) {
		//console.log("chrome.tabs.onCreated(" + tab.id+ ")");
		if(tab.selected) {
			page.currentTabId = tab.id;
			event.invoke(page.switchTab, null, tab.id, []);
		}
	}
});

/**
 * Remove information structure of closed tab for freeing memory
 * @param {integer} tabId
 * @param {object} removeInfo
 */
chrome.tabs.onRemoved.addListener(function(tabId, removeInfo) {
	delete page.tabs[tabId];
	if(page.currentTabId == tabId) {
		page.currentTabId = -1;
	}
    mooltipass.device.onTabClosed(tabId, removeInfo);
});

/**
 * Remove stored credentials on switching tabs.
 * Invoke functions to retrieve credentials for focused tab
 * @param {object} activeInfo
 */
chrome.tabs.onActivated.addListener(function(activeInfo) {
	// remove possible credentials from old tab information
    page.clearCredentials(page.currentTabId, true);
	browserAction.removeRememberPopup(null, {"id": page.currentTabId}, true);

	chrome.tabs.get(activeInfo.tabId, function(info) {
		//console.log(info.id + ": " + info.url);
		if(info && info.id) {
			page.currentTabId = info.id;
			if(info.status == "complete") {
				//console.log("event.invoke(page.switchTab, null, "+info.id + ", []);");
				event.invoke(page.switchTab, null, info.id, []);
			}
		}
	});
});

/**
 * Update browserAction on every update of the page
 * @param {integer} tabId
 * @param {object} changeInfo
 */
chrome.tabs.onUpdated.addListener(function(tabId, changeInfo, tab) {
	if(changeInfo.status == "complete") {
		event.invoke(browserAction.removeRememberPopup, null, tabId, []);
	}
    mooltipass.device.onTabUpdated(tabId, changeInfo);
});

/**
 * Detect POST requests and call the content script to check if it is waiting for it
 */

// Firefox 50+ allows requestBody in the options
if ( isFirefox && typeof( Symbol.hasInstance ) == 'undefined' ) var webRequestOptions = ['blocking'];
else var webRequestOptions = ['blocking','requestBody'];

chrome.webRequest.onBeforeRequest.addListener( function (details) {
	//console.log( details );

	// Test for captcha calls (we don't want to submit if there's a captcha)
	var b = new RegExp('recaptcha');
	if (b.test(details.url)) {
		chrome.tabs.sendMessage( details.tabId, {action: 'captcha_detected', details: details});
	}

	// Intercept posts
	if (details.method == "POST") {
		// Deal both with RAW DATA and FORM DATA
		if (details && details.type === "xmlhttprequest") {
			if ( details.requestBody && details.requestBody.raw ) {
				var buffer = details.requestBody.raw[0].bytes;
				var parsed = arrayBufferToData.toJSON(buffer);
				chrome.tabs.sendMessage( details.tabId, {action: 'post_detected', post_data: parsed });	
			} 
		} else {
			chrome.tabs.sendMessage( details.tabId, {action: 'post_detected', details: details});	
		}
	}
}, { urls: ["<all_urls>"]},webRequestOptions);

/**
 * Retrieve Credentials and try auto-login for HTTPAuth requests
 */
if ( chrome.webRequest.onAuthRequired ) {
	chrome.webRequest.onAuthRequired.addListener(httpAuth.handleRequest,
		{ urls: ["<all_urls>"] }, ["asyncBlocking"]
	);	
}

/**
 * Interaction between background-script and front-script
 */
chrome.runtime.onMessage.addListener(event.onMessage);


/**
 * Add context menu entry for filling in username + password
 */
chrome.contextMenus.create({
	"title": "Fill &User + Pass",
	"contexts": [ "editable" ],
	"onclick": function(info, tab) {
		chrome.tabs.sendMessage(tab.id, {
			action: "fill_user_pass"
		});
	}
});

/**
 * Add context menu entry for filling in only password which matches for given username
 */
chrome.contextMenus.create({
	"title": "Fill &Pass Only",
	"contexts": [ "editable" ],
	"onclick": function(info, tab) {
		chrome.tabs.sendMessage(tab.id, {
			action: "fill_pass_only"
		});
	}
});

/**
 * Add context menu entry for creating icon for generate-password dialog
 */
chrome.contextMenus.create({
	"title": "Show Password &Generator Icons",
	"contexts": [ "editable" ],
	"onclick": function(info, tab) {
		chrome.tabs.sendMessage(tab.id, {
			action: "activate_password_generator"
		});
	}
});

/**
 * Add context menu entry for creating icon for generate-password dialog
 */
chrome.contextMenus.create({
	"title": "&Save credentials",
	"contexts": [ "editable" ],
	"onclick": function(info, tab) {
		chrome.tabs.sendMessage(tab.id, {
			action: "remember_credentials"
		});
	}
});


/**
 * Interval which updates the browserAction (e.g. blinking icon)
 */
window.setInterval(function() {
	browserAction.update(_interval);
}, _interval);

window.setInterval(function() {
	if(page.currentTabId && page.currentTabId > 0 && page.allLoaded) {
		chrome.tabs.sendMessage(page.currentTabId, {
			action: "check_for_new_input_fields"
		});
	}
}, _intervalCheckForNewInputs);

// ArrayBuffer to JSON (by Gaston)
var arrayBufferToData = {
	toBase64: function (arrayBuffer) {
		var binary = '';
		var bytes = new Uint8Array(arrayBuffer);
		var len = bytes.byteLength;
		for (var i = 0; i < len; i++) {
			binary += String.fromCharCode(bytes[i]);
		}
		return window.btoa(binary);
	},
	toString: function (arrayBuffer) {
		var base64 = this.toBase64(arrayBuffer);
		return decodeURIComponent(escape(window.atob(base64)));
	},
	toJSON: function (arrayBuffer) {
		try {
			var string = this.toString(arrayBuffer);
			return JSON.parse(string);
		} catch (e) {
			return {};
		}
	}
};