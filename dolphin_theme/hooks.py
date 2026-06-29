app_name = "dolphin_theme"
app_title = "Dolphin Theme"
app_publisher = "Dolphin International"
app_description = "Navy/gold desk theme for Dolphin International ERP"
app_email = "manjukandkur@gmail.com"
app_license = "MIT"

# Bundle file built by Frappe's esbuild and included on every desk page.
app_include_css = "dolphin_theme.bundle.css"
app_include_js = ["dolphin_theme.bundle.js", "dolphin_new_bi.bundle.js"]

# Resolve friendly import inputs + back-reference blocks to their Buyer Inspection.
doc_events = {
	"Buyer Inspection": {
		"before_validate": "dolphin_theme.bi_import.resolve_bi",
		"on_update": "dolphin_theme.bi_import.backref_blocks",
	}
}
