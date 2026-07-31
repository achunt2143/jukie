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

enyo.kind({
	name: "kindSettingsView",
	kind: "listViewDraggable",
	className: "view jukieSettingsView",
	height: "100%",
	events: {onSaveSettings: "", onCloseSettings: "", onClearCache: ""},

	components: [
		{name: "header", kind: "ctrlListViewHeader", strHeaderTitle: $L("Preferences"), boolShowSearchBtn: false},
		{name: "content", kind: "Control", layoutKind: "VFlexLayout", className: "list", flex: 1, components: [
			{name: "scroller", kind: "Scroller", flex: 1, components: [
				{className: "jukieSettingsList", components: [
					{className: "jukieBoxSection", components: [
						{content: $L("Account"), className: "jukieBoxSectionCaption"},
						{layoutKind: "VFlexLayout", className: "jukieSettingsRow", components: [
							{content: $L("Developer Token (JWT)"), className: "jukieSettingsLabel"},
							{name: "inDevToken", kind: "Input", className: "jukieSettingsInput", hint: $L("Paste developer token"), autocorrect: false, spellcheck: false},
							{content: $L("The web developer token expires about every 35 days."), className: "jukieSettingsHint"}
						]},
						{layoutKind: "VFlexLayout", className: "jukieSettingsRow", components: [
							{content: $L("Music User Token"), className: "jukieSettingsLabel"},
							{name: "inUserToken", kind: "Input", className: "jukieSettingsInput", hint: $L("Paste music-user token"), autocorrect: false, spellcheck: false},
							{content: $L("Identifies your Apple Music account for library and full-track playback."), className: "jukieSettingsHint"}
						]},
						{layoutKind: "HFlexLayout", align: "center", className: "jukieSettingsRow", components: [
							{content: $L("Storefront"), className: "jukieSettingsLabel", flex: 1},
							{name: "selStorefront", kind: "ListSelector", value: "us", items: JUKIE_STOREFRONTS}
						]}
					]},
					{className: "jukieBoxSection", components: [
						{content: $L("Playback"), className: "jukieBoxSectionCaption"},
						{layoutKind: "HFlexLayout", align: "center", className: "jukieSettingsRow", components: [
							{content: $L("Cache downloads on device"), className: "jukieSettingsLabel", flex: 1},
							{name: "togCache", kind: "ToggleButton", onLabel: $L("On"), offLabel: $L("Off"), state: true}
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
						{name: "lblClearCacheResult", className: "jukieSettingsNote", content: ""}
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
		this.$.inDevToken.setValue(s.developerToken || "");
		this.$.inUserToken.setValue(s.musicUserToken || "");
		this.$.selStorefront.setValue(s.storefront || "us");
		this.$.togCache.setState(s.cacheEnabled !== false);
		this.$.selQuality.setValue(s.streamQuality || "high");
		this.$.lblClearCacheResult.setContent("");
	},

	getValues: function () {
		return {
			developerToken: this._trim(this.$.inDevToken.getValue()),
			musicUserToken: this._trim(this.$.inUserToken.getValue()),
			storefront: this.$.selStorefront.getValue() || "us",
			cacheEnabled: !!this.$.togCache.getState(),
			streamQuality: this.$.selQuality.getValue() || "high"
		};
	},

	onclick_Back: function () {
		this.doCloseSettings();
	},

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
