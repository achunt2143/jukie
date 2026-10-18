/*globals enyo, $L */
/*
 * kindSettingsView - the full-screen Preferences scene, shown by swapping the paneTop
 * view (same mechanism as the fullscreen album-art view). Built on listViewDraggable so
 * it shares the exact chrome of the Songs/Artists/Albums lists: the ctrlListViewHeader
 * bar on top, the `.list` body, and a footer action bar (Back / Save). Sections use plain
 * styled Controls (.jukieBoxSection/.jukieBoxSectionCaption, shared with helpView.js - see
 * jukie-theme.css), not enyo.RowGroup - compared on-device against the stock Sounds &
 * Ringtones app, RowGroup's native border-image frame renders far too faint here (just a
 * flat label bar, no clearly visible box, especially on the bottom edge), so this draws its
 * own box instead.
 *
 * Emits onSaveSettings (gathered values) and onCloseSettings (back without saving);
 * app.js persists via kindSettings and slides paneTop back to the main view.
 */

// Apple Music storefront codes -> display names, alphabetized by country for the picker.
// Not exhaustive (Apple supports 100+), but covers the large majority of real accounts.
var JUKIE_STOREFRONTS = [
	{caption: "Argentina", value: "ar"}, {caption: "Australia", value: "au"},
	{caption: "Austria", value: "at"}, {caption: "Bahrain", value: "bh"},
	{caption: "Bangladesh", value: "bd"}, {caption: "Belgium", value: "be"},
	{caption: "Bolivia", value: "bo"}, {caption: "Brazil", value: "br"},
	{caption: "Bulgaria", value: "bg"}, {caption: "Canada", value: "ca"},
	{caption: "Chile", value: "cl"}, {caption: "China", value: "cn"},
	{caption: "Colombia", value: "co"}, {caption: "Costa Rica", value: "cr"},
	{caption: "Croatia", value: "hr"}, {caption: "Cyprus", value: "cy"},
	{caption: "Czech Republic", value: "cz"}, {caption: "Denmark", value: "dk"},
	{caption: "Dominican Republic", value: "do"}, {caption: "Ecuador", value: "ec"},
	{caption: "Egypt", value: "eg"}, {caption: "El Salvador", value: "sv"},
	{caption: "Estonia", value: "ee"}, {caption: "Finland", value: "fi"},
	{caption: "France", value: "fr"}, {caption: "Germany", value: "de"},
	{caption: "Ghana", value: "gh"}, {caption: "Greece", value: "gr"},
	{caption: "Guatemala", value: "gt"}, {caption: "Honduras", value: "hn"},
	{caption: "Hong Kong", value: "hk"}, {caption: "Hungary", value: "hu"},
	{caption: "Iceland", value: "is"}, {caption: "India", value: "in"},
	{caption: "Indonesia", value: "id"}, {caption: "Ireland", value: "ie"},
	{caption: "Israel", value: "il"}, {caption: "Italy", value: "it"},
	{caption: "Japan", value: "jp"}, {caption: "Jordan", value: "jo"},
	{caption: "Kenya", value: "ke"}, {caption: "Kuwait", value: "kw"},
	{caption: "Latvia", value: "lv"}, {caption: "Lebanon", value: "lb"},
	{caption: "Lithuania", value: "lt"}, {caption: "Luxembourg", value: "lu"},
	{caption: "Macau", value: "mo"}, {caption: "Malaysia", value: "my"},
	{caption: "Malta", value: "mt"}, {caption: "Mexico", value: "mx"},
	{caption: "Netherlands", value: "nl"}, {caption: "New Zealand", value: "nz"},
	{caption: "Nicaragua", value: "ni"}, {caption: "Nigeria", value: "ng"},
	{caption: "Norway", value: "no"}, {caption: "Oman", value: "om"},
	{caption: "Pakistan", value: "pk"}, {caption: "Panama", value: "pa"},
	{caption: "Paraguay", value: "py"}, {caption: "Peru", value: "pe"},
	{caption: "Philippines", value: "ph"}, {caption: "Poland", value: "pl"},
	{caption: "Portugal", value: "pt"}, {caption: "Qatar", value: "qa"},
	{caption: "Romania", value: "ro"}, {caption: "Russia", value: "ru"},
	{caption: "Saudi Arabia", value: "sa"}, {caption: "Singapore", value: "sg"},
	{caption: "Slovakia", value: "sk"}, {caption: "Slovenia", value: "si"},
	{caption: "South Africa", value: "za"}, {caption: "South Korea", value: "kr"},
	{caption: "Spain", value: "es"}, {caption: "Sri Lanka", value: "lk"},
	{caption: "Sweden", value: "se"}, {caption: "Switzerland", value: "ch"},
	{caption: "Taiwan", value: "tw"}, {caption: "Thailand", value: "th"},
	{caption: "Turkey", value: "tr"}, {caption: "Ukraine", value: "ua"},
	{caption: "United Arab Emirates", value: "ae"}, {caption: "United Kingdom", value: "gb"},
	{caption: "United States", value: "us"}, {caption: "Uruguay", value: "uy"},
	{caption: "Venezuela", value: "ve"}, {caption: "Vietnam", value: "vn"}
];

// Track cache size choices, in MB. 0 keeps only the track being played; tracks saved for
// offline play are never evicted and don't count against this limit.
var JUKIE_CACHE_SIZES = [
	{caption: "Off (current track only)", value: 0},
	{caption: "128 MB", value: 128}, {caption: "256 MB", value: 256},
	{caption: "512 MB", value: 512}, {caption: "1 GB", value: 1024},
	{caption: "2 GB", value: 2048}, {caption: "4 GB", value: 4096},
	{caption: "8 GB", value: 8192}
];

enyo.kind({
	name: "kindSettingsView",
	kind: "listViewDraggable",
	className: "view jukieSettingsView",
	height: "100%",
	events: {onSaveSettings: "", onCloseSettings: "", onClearCache: "", onGetCacheInfo: ""},

	components: [
		// Signs in through the webOS OAuth broker (apple_musickit flow, apps/applemusic on the
		// broker): the device shows a code, the user finishes Apple's sign-in on a phone or
		// computer, and the Music User Token comes back here. To try a local broker, set
		// brokerBaseUrl on this component (the helper's default is https://oauth.wosa.link).
		{kind: "Helpers.OAuthBroker", name: "broker", appName: "applemusic",
			onCode: "showCode", onConnected: "storeTokens", onExpired: "codeExpired", onError: "brokerError"},
		{name: "header", kind: "ctrlListViewHeader", strHeaderTitle: $L("Preferences"), boolShowSearchBtn: false},
		{name: "content", kind: "Control", layoutKind: "VFlexLayout", className: "list", flex: 1, components: [
			{name: "scroller", kind: "Scroller", flex: 1, components: [
				{className: "jukieSettingsList", components: [
					{className: "jukieBoxSection", components: [
						{content: $L("Account"), className: "jukieBoxSectionCaption"},
						{layoutKind: "VFlexLayout", className: "jukieSettingsRow", components: [
							{name: "lblSignedIn", className: "jukieSettingsLabel"},
							{name: "btnSignIn", kind: "Button", caption: $L("Sign in with Apple Music"), className: "enyo-button-affirmative", onclick: "onclick_SignIn"},
							{content: $L("You finish signing in on a phone or computer."), className: "jukieSettingsHint"},
							{name: "signInPanel", showing: false, className: "jukieSignInPanel", components: [
								{content: $L("On a phone or computer, go to:"), className: "jukieSettingsHint"},
								{name: "signInUrl", className: "jukieSignInUrl"},
								{content: $L("and enter this code:"), className: "jukieSettingsHint"},
								{name: "signInCode", className: "jukieSignInCode"},
								{content: $L("or scan to open it pre-filled:"), className: "jukieSettingsHint"},
								{name: "signInQr", kind: "QrCode", size: 200, className: "jukieSignInQr"},
								{name: "signInStatus", className: "jukieSettingsHint"},
								{layoutKind: "HFlexLayout", pack: "center", components: [
									{kind: "Button", caption: $L("Check now"), onclick: "onclick_SignInCheck"},
									{kind: "Button", caption: $L("Cancel"), className: "enyo-button-negative", onclick: "onclick_SignInCancel"}
								]}
							]},
							{name: "signInError", showing: false, className: "jukieSignInError"}
						]},
						{layoutKind: "HFlexLayout", align: "center", className: "jukieSettingsRow", components: [
							{content: $L("Storefront"), className: "jukieSettingsLabel", flex: 1},
							{name: "selStorefront", kind: "ListSelector", value: "us", items: JUKIE_STOREFRONTS}
						]}
					]},
					{className: "jukieBoxSection", components: [
						{content: $L("Playback"), className: "jukieBoxSectionCaption"},
						{layoutKind: "HFlexLayout", align: "center", className: "jukieSettingsRow", components: [
							{content: $L("Cache size"), className: "jukieSettingsLabel", flex: 1},
							{name: "selCacheSize", kind: "ListSelector", value: 512, items: JUKIE_CACHE_SIZES}
						]},
						{layoutKind: "HFlexLayout", align: "center", className: "jukieSettingsRow", components: [
							{content: $L("Stream quality"), className: "jukieSettingsLabel", flex: 1},
							{name: "selQuality", kind: "ListSelector", value: "high", items: [
								{caption: $L("High (256 kbps)"), value: "high"},
								{caption: $L("Standard"), value: "standard"}
							]}
						]},
						{className: "jukieSettingsNote", content: $L("High is the only Widevine flavor available for full-track playback; Standard falls back to previews.")}
					]},
					{className: "jukieBoxSection", components: [
						{content: $L("Storage"), className: "jukieBoxSectionCaption"},
						{layoutKind: "HFlexLayout", align: "center", className: "jukieSettingsRow", components: [
							{content: $L("Downloaded tracks"), className: "jukieSettingsLabel", flex: 1},
							{name: "btnClearCache", kind: "Button", caption: $L("Clear Cache"), onclick: "onclick_ClearCache"}
						]},
						{name: "lblClearCacheResult", className: "jukieSettingsNote", content: ""},
							{name: "lblCacheUsage", className: "jukieSettingsNote", content: ""},
							{className: "jukieSettingsNote", content: $L("Songs you save for offline play are kept no matter what the cache size is, and Clear Cache leaves them alone.")}
					]}
				]}
			]}
		]},
		{kind: "Toolbar", className: "enyo-toolbar-light jukieSettingsFooter", layoutKind: "HFlexLayout", pack: "justify", align: "center", components: [
			{kind: "Button", caption: $L("Back"), className: "enyo-button-light", onclick: "onclick_Back"},
			{name: "btnSave", kind: "Button", caption: $L("Save"), className: "enyo-button-affirmative", onclick: "onclick_Save"}
		]}
	],

	ready: function () {
		this.inherited(arguments);
		this.$.header.setStrHeaderTitle($L("Preferences"));
	},

	// Populate fields from a settings object (call before showing the view).
	setValues: function (settings) {
		var s = settings || {};
		// The tokens are never shown or edited: they ride along here so Save writes them back.
		this._developerToken = s.developerToken || "";
		this._musicUserToken = s.musicUserToken || "";
		this._showSignedIn();
		this.$.selStorefront.setValue(s.storefront || "us");
		var limit = (typeof s.cacheLimitMB === "number") ? s.cacheLimitMB : 512;
		var sizes = JUKIE_CACHE_SIZES.slice(), i, found = false;
		for (i = 0; i < sizes.length; i++) { if (sizes[i].value === limit) { found = true; } }
		if (!found)
		{
			// A limit set some other way (e.g. luna-send) still shows up as itself.
			sizes.push({caption: limit + " MB", value: limit});
		}
		this.$.selCacheSize.setItems(sizes);
		this.$.selCacheSize.setValue(limit);
		this.$.selQuality.setValue(s.streamQuality || "high");
		this.$.lblClearCacheResult.setContent("");
		this._cancelSignIn();
		this._showSignInError("");
		this.refreshCacheUsage();
	},

	_fmtBytes: function (b)
	{
		var mb = (b || 0) / 1048576;
		if (mb >= 1024) { return (Math.round(mb / 102.4) / 10) + " GB"; }
		return (mb < 10 ? Math.round(mb * 10) / 10 : Math.round(mb)) + " MB";
	},

	// "In use: 312 MB - Saved offline: 2 songs (15 MB)", straight from the service's files.
	refreshCacheUsage: function ()
	{
		var self = this;
		this.$.lblCacheUsage.setContent("");
		this.doGetCacheInfo(function (r)
		{
			if (!r || r.returnValue === false) { return; }
			var n = r.pinnedCount || 0;
			self.$.lblCacheUsage.setContent($L("In use: ") + self._fmtBytes(r.usedBytes) + " · " +
				$L("Saved offline: ") + n + (n === 1 ? $L(" song") : $L(" songs")) + " (" + self._fmtBytes(r.pinnedBytes) + ")");
		});
	},

	getValues: function () {
		return {
			developerToken: this._developerToken || "",
			musicUserToken: this._musicUserToken || "",
			storefront: this.$.selStorefront.getValue() || "us",
			cacheLimitMB: this.$.selCacheSize.getValue(),
			streamQuality: this.$.selQuality.getValue() || "high"
		};
	},

	onclick_Back: function () {
		this._cancelSignIn();
		this.doCloseSettings();
	},

	//#region Sign in with Apple Music (via the OAuth broker)

	onclick_SignIn: function () {
		this._showSignInError("");
		this.$.btnSignIn.setDisabled(true);
		this.$.broker.start();
	},

	onclick_SignInCheck: function () {
		this.$.signInStatus.setContent($L("Checking…"));
		this.$.broker.checkNow();
	},

	onclick_SignInCancel: function () {
		this._cancelSignIn();
		this._showSignInError("");
	},

	_cancelSignIn: function () {
		this.$.broker.stop();
		this.$.signInPanel.setShowing(false);
		this.$.btnSignIn.setDisabled(false);
	},

	_showSignedIn: function () {
		this.$.lblSignedIn.setContent(this._musicUserToken ? $L("Signed in to Apple Music") : $L("Not signed in"));
		this.$.btnSignIn.setCaption(this._musicUserToken ? $L("Sign in again") : $L("Sign in with Apple Music"));
	},

	_showSignInError: function (message) {
		this.$.signInError.setContent(message || "");
		this.$.signInError.setShowing(!!message);
	},

	// onCode: the broker minted a code and began polling in the background.
	showCode: function (sender, info) {
		this.$.signInUrl.setContent(info.useUrl);
		this.$.signInCode.setContent(info.code);
		// activate.php?app=&code= works on every host (no rewrite), and pre-fills the code.
		this.$.signInQr.setText(this.$.broker.getBrokerBaseUrl() + "/activate.php?app=" +
			encodeURIComponent(this.$.broker.getAppName()) + "&code=" + encodeURIComponent(info.code));
		this.$.signInStatus.setContent($L("Waiting for you to finish signing in…"));
		this.$.signInPanel.setShowing(true);
		return true;
	},

	// onConnected: the Music User Token arrives exactly once. Fill the fields, then save so
	// the app applies it (and re-syncs the library) the same as a manual paste + Save.
	storeTokens: function (sender, tokens) {
		var token = tokens.music_user_token || tokens.access_token || "";
		var i;
		this.$.signInPanel.setShowing(false);
		this.$.btnSignIn.setDisabled(false);
		if (!token) {
			this._showSignInError($L("Apple did not return a sign-in token. Please try again."));
			return true;
		}
		this._musicUserToken = token;
		this._showSignedIn();
		for (i = 0; i < JUKIE_STOREFRONTS.length; i++) {
			if (JUKIE_STOREFRONTS[i].value === tokens.storefront) {
				this.$.selStorefront.setValue(tokens.storefront);
				break;
			}
		}
		this.doSaveSettings(this.getValues());
		return true;
	},

	codeExpired: function () {
		this.$.signInStatus.setContent($L("That code expired. Tap Cancel, then sign in again."));
		return true;
	},

	brokerError: function (sender, message) {
		this._cancelSignIn();
		this._showSignInError(message || $L("Could not reach the sign-in service. Check your connection and try again."));
		return true;
	},

	//#endregion

	onclick_Save: function () {
		this.doSaveSettings(this.getValues());
	},

	// Clearing is independent of the cache on/off toggle - the user shouldn't have to
	// disable caching just to free up space right now. Delegates to the service (which
	// keeps whatever's currently playing) via kindPlayback -> kindAudioPlayer.
	onclick_ClearCache: function () {
		var self = this;
		this.$.btnClearCache.setDisabled(true);
		this.$.lblClearCacheResult.setContent($L("Clearing…"));
		this.doClearCache(function (response) {
			self.$.btnClearCache.setDisabled(false);
			if (response && response.returnValue) {
				var mb = Math.round((response.freedBytes || 0) / (1024 * 1024));
				self.$.lblClearCacheResult.setContent(
					response.removed > 0
						? $L("Cleared ") + response.removed + $L(" track(s), freed ~") + mb + " MB."
						: $L("Cache was already empty.")
				);
			} else {
				self.$.lblClearCacheResult.setContent($L("Could not clear cache."));
			}
		});
	},

	_trim: function (s) {
		return ("" + (s || "")).replace(/^\s+|\s+$/g, "");
	}
});
