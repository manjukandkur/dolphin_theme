app_name = "dolphin_theme"
app_title = "Dolphin Theme"
app_publisher = "Dolphin International"
app_description = "Navy/gold desk theme for Dolphin International ERP"
app_email = "manjukandkur@gmail.com"
app_license = "MIT"

# Bundle file built by Frappe's esbuild and included on every desk page.
app_include_css = "dolphin_theme.bundle.css"
# dolphin_patch.js loads AFTER the bundle to enforce a single Trace-a-block box
# and the menu changes. Remove the patch entry (and the file) to revert.
app_include_js = ["dolphin_theme.bundle.js", "dolphin_patch.bundle.js"]
