frappe.pages['dolphin-stock'].on_page_load = function (wrapper) {
	var page = frappe.ui.make_app_page({
		parent: wrapper,
		title: 'Stock Dashboard',
		single_column: true
	});

	var iframe = document.createElement('iframe');
	iframe.src = '/assets/dolphin_theme/dashboard/dolphin_stock.html';
	iframe.title = 'Dolphin Stock Dashboard';
	iframe.setAttribute('frameborder', '0');
	iframe.style.cssText = 'width:100%;height:calc(100vh - 70px);border:0;display:block;background:#eef1f6;';

	var $body = $(page.body);
	$body.empty().append(iframe);
	$body.css({ 'padding': '0', 'margin': '0' });

	// Reload button in the page toolbar refreshes the embedded dashboard
	page.set_primary_action('Reload', function () {
		iframe.src = iframe.src;
	}, 'refresh');
};
