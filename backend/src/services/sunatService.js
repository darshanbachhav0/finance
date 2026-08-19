import { ManualSunatProvider } from "../integrations/sunat/ManualSunatProvider.js";
import { MockSunatProvider } from "../integrations/sunat/MockSunatProvider.js";
import { NotConfiguredSunatProvider } from "../integrations/sunat/NotConfiguredSunatProvider.js";

export function getSunatProvider(mode = process.env.SUNAT_PROVIDER_MODE || "MANUAL") {
  if (String(mode).toUpperCase() === "MOCK") return new MockSunatProvider();
  if (String(mode).toUpperCase() === "MANUAL") return new ManualSunatProvider();
  return new NotConfiguredSunatProvider();
}

export const sunatService = {
  status() {
    const provider = getSunatProvider();
    return {
      mode: provider.mode,
      configured: provider.configured,
      state: provider.configured ? provider.mode : "NOT_CONFIGURED"
    };
  },
  validateTaxpayer(identifier, context) {
    return getSunatProvider().validateTaxpayer(identifier, context);
  },
  validateVoucher(voucher, context) {
    return getSunatProvider().validateVoucher(voucher, context);
  },
  getSellingExchangeRate(input, context) {
    return getSunatProvider().getSellingExchangeRate(input, context);
  }
};
