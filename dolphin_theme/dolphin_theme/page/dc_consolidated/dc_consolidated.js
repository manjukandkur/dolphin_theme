frappe.pages['dc-consolidated'].on_page_load = function (wrapper) {
	var page = frappe.ui.make_app_page({
		parent: wrapper,
		title: 'DC Consolidated',
		single_column: true
	});
	var $body = $(page.body).css({ 'padding': '0', 'margin': '0' });
	function load() {
		$body.empty();
		var iframe = document.createElement('iframe');
		// embed=1 -> the www page hides its own header; the desk provides the real chrome
		iframe.src = '/dc-fullview?embed=1&v=' + Date.now();
		iframe.title = 'DC Consolidated';
		iframe.setAttribute('frameborder', '0');
		iframe.style.cssText = 'width:100%;height:calc(100vh - 70px);border:0;display:block;background:#eef1f5;';
		$body.append(iframe);
	}
	wrapper._dolphinLoad = load;
	load();
	page.set_primary_action('Reload', load, 'refresh');
};
frappe.pages['dc-consolidated'].on_page_show = function (wrapper) {
	try { if (wrapper._dolphinLoad && !$(wrapper).find('iframe').length) { wrapper._dolphinLoad(); } } catch (e) {}
};
