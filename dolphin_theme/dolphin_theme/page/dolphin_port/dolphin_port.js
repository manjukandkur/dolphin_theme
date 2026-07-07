frappe.pages['dolphin-port'].on_page_load = function (wrapper) {
	var page = frappe.ui.make_app_page({
		parent: wrapper,
		title: 'Port & Stock',
		single_column: true
	});
	var $body = $(page.body).css({ 'padding': '0', 'margin': '0' });
	function load() {
		$body.empty();
		var iframe = document.createElement('iframe');
		// embed=1 tells the www page to hide its own Back/Home/Menu bar (the desk already provides it)
		iframe.src = '/port-reconciliation?embed=1&v=' + Date.now();
		iframe.title = 'Port & Stock';
		iframe.setAttribute('frameborder', '0');
		iframe.style.cssText = 'width:100%;height:calc(100vh - 70px);border:0;display:block;background:#fff;';
		$body.append(iframe);
	}
	wrapper._dolphinLoad = load;
	load();
	page.set_primary_action('Reload', load, 'refresh');
};
frappe.pages['dolphin-port'].on_page_show = function (wrapper) {
	try { if (wrapper._dolphinLoad && !$(wrapper).find('iframe').length) { wrapper._dolphinLoad(); } } catch (e) {}
};
