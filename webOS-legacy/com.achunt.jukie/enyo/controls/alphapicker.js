/*globals enyo, $L, event, console */
enyo.kind({
	name: "AlphaPicker",
	kind: "VFlexBox",
	defaultKind: "Control",
	published: {},
	events: {onAlphaPicked:""},
	className: "superScrollAlpha",
	components: [
					 
					 
							 
					 
	],

	chrCurrAlpha: "",
	
	create: function () {
		
		try
		{
			this.inherited(arguments);
			
		}
		catch (err)
		{
			this.log("error: ", err);
		}	
		
		
	},
	
	ready: function () {
	
		try
		{
			this.inherited(arguments);

			
		}
		catch (err)
		{
			this.log("error: ", err);
		}	
		
		
	},
	
	
	populate: function (objAlphaJumps)
	{
		

		this.log();

		this.arIndexChars = enyo.g11n.Char.getIndexChars();
		// getIndexChars() appends "#" at the END (its intl convention for "starts with a
		// non-alphabetic char"), but our library lists actually sort numeric/symbol-led
		// names FIRST (plain ascending string sort puts digits before letters) - move "#"
		// to the front so the picker's order matches what's really on screen.
		var intHashIndex = this.arIndexChars.indexOf("#");
		if (intHashIndex > 0)
		{
			this.arIndexChars.splice(intHashIndex, 1);
			this.arIndexChars.unshift("#");
		}
		this.log(this.arIndexChars);
	
		this.destroyControls();
			
		this.createComponent({name: "alphaGrow", kind: "Control", className: "alphaGrow", showing: false});
		
		var charAlpha;
		for(var intIndexChar = 0; intIndexChar < this.arIndexChars.length; intIndexChar++)
		{
				
			charAlpha = this.arIndexChars[intIndexChar];
			this.log("charAlpha: ", charAlpha);
			var ctrlAlpha = this.createComponent({name: "ctrlAlpha_" + charAlpha, kind: "Control", content: charAlpha, flex: 1, className: "alphaLetter", onclick: "onClick_Alpha", ondragstart: "ondragstart_Alpha", ondragfinish: "ondragfinish_Alpha", ondrag: "ondrag_Alpha", ondrop: "ondrop_Alpha",ondragover: "ondragover_Alpha", ondragout: "ondragout_Alpha"});
			
			if(objAlphaJumps[charAlpha] !== undefined)
			{
				ctrlAlpha.addClass("alphaOn");
			}
			else
			{
				ctrlAlpha.addClass("alphaOff");				
			}
			
			
		}
		
		this.contentChanged();
		
	},
	
	
	onClick_Alpha: function (sender, event)
	{
		
		this.log();
		this.log(sender);
		//this.log(event);
		
		this.doAlphaPicked(sender.content);
		
	},
	
	
	onMouseDown_Alpha: function ()
	{
		this.log();	
	},
	
	
	onMouseUp_Alpha: function ()
	{
		this.log();	
	},
	
	onMouseOver_Alpha: function (sender, event)
	{
		this.log();
		this.log(sender);
		sender.addClass("alphaGrow");
		
	},
	
	onMouseOut_Alpha: function (sender, event)
	{
		this.log();
		sender.removeClass("alphaGrow");

	},
		
	ondragstart_Alpha: function (sender, event)
	{
		this.log();
		
	},
		
	ondragfinish_Alpha: function (sender, event)
	{
		this.log();
		
	},
		
	ondrag_Alpha: function (sender, event)
	{
		this.log();
		this.log(sender.name);
		this.log(sender.content);
		
		//this.$.alphaGrow.setShowing(true);
		//this.$.alphaGrow.setContent(sender.content);
		//this.$.alphaGrow.applyStyle("top",event.pageY + "px");


	},
	

	ondrop_Alpha: function (sender, event)
	{
		this.log();
		// Drop always fires the FINAL letter immediately (cancel any pending throttled
		// fire first) so release always lands exactly where the finger left off.
		if (this._alphaThrottleTimer)
		{
			window.clearTimeout(this._alphaThrottleTimer);
			this._alphaThrottleTimer = null;
		}
		this.doAlphaPicked(sender.content);
		this.$.alphaGrow.setShowing(false);


	},

	// Actually jumping the list does real work (resets the VirtualList's render window) -
	// fine once per tap, but a fast continuous drag can cross a dozen+ letters a second,
	// and firing a jump for every single one queues up a backlog of synchronous work that
	// blocks the browser from painting anything - INCLUDING the letter-preview bubble below,
	// which then visibly lags your finger by however long that backlog takes to drain. Throttle
	// the jump itself (trailing-edge - always keeps the latest letter pending) while the cheap
	// bubble update stays completely unthrottled so it always tracks your finger immediately.
	ALPHA_THROTTLE_MS: 80,
	_throttledAlphaPicked: function (chrAlpha)
	{
		var self = this;
		this._pendingAlpha = chrAlpha;
		if (this._alphaThrottleTimer)
		{
			return; // a fire is already scheduled - it will pick up the latest _pendingAlpha
		}
		var elapsed = Date.now() - (this._lastAlphaFire || 0);
		var wait = Math.max(0, this.ALPHA_THROTTLE_MS - elapsed);
		this._alphaThrottleTimer = window.setTimeout(function () {
			self._alphaThrottleTimer = null;
			self._lastAlphaFire = Date.now();
			self.doAlphaPicked(self._pendingAlpha);
		}, wait);
	},

	ondragover_Alpha: function (sender, event)
	{
		// The letter-preview bubble MUST update first and unconditionally, before anything
		// that could block - see _throttledAlphaPicked above for why.
		this.$.alphaGrow.setShowing(true);
		this.$.alphaGrow.setContent(sender.content);
		this.$.alphaGrow.applyStyle("top",(event.pageY - 40) + "px");

		// Real A-Z scrub: jump the list AS SOON as the finger crosses onto a new letter,
		// not after holding still for a second (the original inherited behavior - it made a
		// normal scrub gesture never actually jump at all, since your finger keeps moving).
		if(this.chrCurrAlpha !== sender.content)
		{
			this.chrCurrAlpha = sender.content;
			this._throttledAlphaPicked(sender.content);
		}

		this.log();
		this.log(sender.name);
		this.log(sender.content);

		return true;

	},
			
	ondragout_Alpha: function (sender, event)
	{
		this.log();
		this.log(sender.name);
		this.log(sender.content);
		//if(this.chrCurrAlpha === sender.content)
		//{
		//	this.$.alphaGrow.setShowing(false);
		//}
	

	},
	
	raiseAlphaPicked: function (chrAlpha)
	{
	
		this.doAlphaPicked(chrAlpha);
	
	}
	
		
});