frappe.pages['loading-desk'].on_page_load = function (wrapper) {
	var page = frappe.ui.make_app_page({
		parent: wrapper,
		title: 'Pending Loading',
		single_column: true
	});
	var $body = $(page.body);
	function load() {
		$body.empty();
		var iframe = document.createElement('iframe');
		iframe.src = '/loading-desk?embed=1';
		iframe.style.cssText = 'width:100%;height:calc(100vh - 100px);border:0;';
		iframe.setAttribute('frameborder', '0');
		$body.append(iframe);
	}
	wrapper._dolphinLoad = load;
	load();
	page.set_primary_action('Reload', load, 'refresh');
};
frappe.pages['loading-desk'].on_page_show = function (wrapper) {
	try { if (wrapper._dolphinLoad && !$(wrapper).find('iframe').length) { wrapper._dolphinLoad(); } } catch (e) {}
};
