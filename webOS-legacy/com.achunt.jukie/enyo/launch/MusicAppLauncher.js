	/*globals PalmSystem, enyo, $L, event, Utilities, window */
	enyo.kind({
	name: "MusicAppLauncher",
	kind: "enyo.Object",
	faces: {
		 musicplayer:
		 {
			  windowName: "com.achunt.jukie",
			  path: "main.html",
			  state: "unknown"
		 },
		 exhibition:
		 {
			  windowName: "com.achunt.jukie.exhibition",
			  path: "exhibition.html",
			  state: "unknown",
			  // Must open as a real dock-mode window, not a plain card. Without this,
			  // webOS's Exhibition manager doesn't recognize our window as the dock
			  // surface and reverts to the default Clock app after ~a minute. Mirrors
			  // the AccuWeather Enyo sample's openWindow(...,{window:"dockMode"}).
			  attributes: {window: "dockMode"}
		 }
	},
	
	/**
	 * This method starts the app.
	 */
	startup: function()
	{
		this.log();
		this.hardenWindowManager();
		var paramString = window.PalmSystem && PalmSystem.launchParams || "{}";
		this.log("paramString: ", paramString);
		this.startParams = JSON.parse(paramString);
		this.log("this.startParams: ", this.startParams);
		this.activateApp(this.appSelect());
	},
	
	/**
	 * Harden a framework/platform gap exposed by the Exhibition (dock-mode) window.
	 *
	 * A dock-mode window is cross-process, so on this WebKit the "enyoWindowReady"
	 * postMessage it sends to its opener (this root window) arrives with an UNDEFINED
	 * message source. enyo's message listener then calls
	 * enyo.windows.manager.executePendingWindowParams(e.source), which dereferences
	 * inWindow.name (via getWindowName) and throws an uncaught TypeError on every dock
	 * entry. The pending-params flush can't do anything for a cross-process window anyway
	 * (its name isn't readable here, so the pending list is keyed by `undefined` and is
	 * always empty), so skipping when the source is missing is strictly safe - it only
	 * silences the noise. Wrap once, forwarding all real windows through untouched.
	 */
	hardenWindowManager: function ()
	{
		try
		{
			var mgr = enyo.windows && enyo.windows.manager;
			if (mgr && !mgr._jukieHardened)
			{
				var orig = mgr.executePendingWindowParams;
				mgr.executePendingWindowParams = function (inWindow)
				{
					if (!inWindow) { return; }
					return orig.apply(this, arguments);
				};
				mgr._jukieHardened = true;
			}
		}
		catch (err)
		{
			this.log("hardenWindowManager failed (non-fatal):", err);
		}
	},

	/**
	 * This is the callback handler responding to the enyo's application relaunch event.
	 */
	applicationRelaunchHandler: function (relaunchParams)
	{
		this.log();
		this.log("relaunchParams:", relaunchParams);
		this.startParams = relaunchParams;
		this.log("this.startParams: ", this.startParams);
		this.activateApp(this.appSelect());
	},
	
	/**
	 * It determines a colleciton of the parameters required to activate a window by examining
	 * the environment.
	 *
	 * @retrun It returns an object containing a collection of the parameters required to activate
	 *         a window.
	 */
	appSelect: function ()
	{
	  this.log();
	  this.log("startParams: ", this.startParams);
		 // Placed on (or launched from) the Touchstone dock -> show Exhibition Mode instead
		 // of the regular player. See faces.exhibition / exhibition.html.
		 if (this.startParams && this.startParams.windowType === "dockModeWindow" && this.startParams.dockMode === true)
		 {
			  return this.faces.exhibition;
		 }
		 return this.faces.musicplayer;
	},
	
	/**
	 * Activate a window identified by name.  If the identified window already existed, then the enyo
	 * window manager will bring it to focus, otherwise it will be created.
	 *
	 * @param app is an object containing the relevant parameters to activate a window.  This app
	 *            is one of the parameters objects defined by the faces property of this kind.
	 */
	activateApp: function (app)
	{
		 this.log();
		 if (!app) { return; }
		 if (!window.PalmSystem)
		 {           // (desktop only): add this extra artifact so that
			  window.name = app.windowName;   //          enyo.windows.browserAgent will not hide the window
		 }                                   //          hosting our app  
	  var allwindows = enyo.windows.getWindows();
	  for (var wins in allwindows)
	  {
		  if(typeof(wins) !== "undefined"){
			  this.log("Windows Before Activation, NAME: ", wins);
		  }
	  }
	  var path = enyo.fetchAppRootPath() + app.path;
	  
	  this.log("PATH IS ", path);
	  
		this.log("this.startParams: ", this.startParams);
	  enyo.windows.activate(app.path,app.windowName,this.startParams,app.attributes);
	  
	  allwindows = enyo.windows.getWindows();
	  for (var win in allwindows)
	  {
		  if(typeof(win) !== "undefined")
		  {
			  this.log("Windows After Activation, NAME: ", win);
		  }
	  }
	},
	
	/**
	 * A debugging helper method.
	 *
	 * @return It returns a debugging message.
	 */
	verboseAppContext: function ()
	{
		 var desc = "no PalmSystem";
		 if (window.PalmSystem)
		 {
			  if (window.PalmSystem.launchParams)
			  {
					// available only at relaunch
					// expect { windowType: "dockModeWindow", dockMode: true }
					desc = "PalmSystem.launchParams = "+window.PalmSystem.launchParams;
			  } else {
					desc = "no PalmSystem.launchParams";
			  }
		 }
		 return desc;
	}
	});
