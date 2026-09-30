// Ask Dolphin record - Revert / Approve / Still stuck (30 Sep 2026)
frappe.ui.form.on("Dolphin Help Question", {
	refresh(frm) {
		const call = (method, args, msg) =>
			frappe.call({ method: "dolphin_theme.help_desk." + method, args: Object.assign({ name: frm.doc.name }, args || {}) })
				.then(() => { frappe.show_alert({ message: msg, indicator: "green" }); frm.reload_doc(); });
		if (frm.doc.change_applied) {
			frm.add_custom_button(__("Revert this change"), () =>
				frappe.confirm(__("Put the screen back exactly as it was before this change?"), () =>
					call("revert_change", null, __("Reverted. Reload the changed screen to see it."))));
		} else if (frm.doc.change_json && frm.doc.status === "Change Requested") {
			frm.add_custom_button(__("Approve and apply change"), () =>
				call("apply_pending_change", null, __("Change applied.")));
		}
		if (!["Needs Admin", "Resolved"].includes(frm.doc.status) && !frm.is_new()) {
			frm.add_custom_button(__("Still stuck — send to admin"), () =>
				call("still_stuck", null, __("Sent to the admin.")));
		}
		if (frm.doc.status === "Needs Admin" && frappe.user.has_role("System Manager")) {
			frm.add_custom_button(__("Mark resolved"), () => { frm.set_value("status", "Resolved"); frm.save(); });
		}
	},
});
