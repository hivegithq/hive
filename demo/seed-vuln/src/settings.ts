import _ from "lodash";

export const DEFAULTS = { currency: "USD", taxRate: 0.08, features: { giftWrap: false } };

// Store settings: the defaults with a store's overrides deep-merged on top.
export function storeSettings(overrides: object) {
	return _.merge({}, DEFAULTS, overrides);
}
