frappe.pages['dolphin-reconcile'].on_page_load = function (wrapper) {
	var page = frappe.ui.make_app_page({
		parent: wrapper,
		title: 'Arrivals Reconciliation',
		single_column: true
	});
	var $body = $(page.body).css({ 'padding': '0', 'margin': '0' });
	function load() {
		$body.empty();
		var iframe = document.createElement('iframe');
		iframe.src = '/dolphin-arrivals?v=' + Date.now();
		iframe.title = 'Arrivals Reconciliation';
		iframe.setAttribute('frameborder', '0');
		iframe.style.cssText = 'width:100%;height:calc(100vh - 70px);border:0;display:block;background:#fff;';
		$body.append(iframe);
	}
	wrapper._dolphinLoad = load;
	load();
	page.set_primary_action('Reload', load, 'refresh');
};
frappe.pages['dolphin-reconcile'].on_page_show = function (wrapper) {
	try { if (wrapper._dolphinLoad && !$(wrapper).find('iframe').length) { wrapper._dolphinLoad(); } } catch (e) {}
};
