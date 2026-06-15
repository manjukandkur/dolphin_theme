frappe.pages['dolphin-stock'].on_page_load = function (wrapper) {
	var page = frappe.ui.make_app_page({
		parent: wrapper,
		title: 'Stock Dashboard',
		single_column: true
	});

	var $body = $(page.body).css({ 'padding': '0', 'margin': '0' });

	function load() {
		$body.empty();
		var iframe = document.createElement('iframe');
		// cache-bust each load so Safari never serves a stale/blank frame
		iframe.src = '/assets/dolphin_theme/dashboard/dolphin_stock.html?v=' + Date.now();
		iframe.title = 'Dolphin Stock Dashboard';
		iframe.setAttribute('frameborder', '0');
		iframe.style.cssText = 'width:100%;height:calc(100vh - 70px);border:0;display:block;background:#eef1f6;';
		$body.append(iframe);
	}

	wrapper._dolphinLoad = load;
	load();

	// Reload button in the page toolbar refreshes the embedded dashboard
	page.set_primary_action('Reload', load, 'refresh');
};

// If the page is revisited and the frame somehow didn't render, rebuild it (fixes the blank-page flash)
frappe.pages['dolphin-stock'].on_page_show = function (wrapper) {
	try {
		if (wrapper._dolphinLoad && !$(wrapper).find('iframe').length) {
			wrapper._dolphinLoad();
		}
	} catch (e) {}
};
