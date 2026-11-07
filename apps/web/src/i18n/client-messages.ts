import type { AbstractIntlMessages } from 'next-intl';

/** Server assembly only: serialize the strings each client subtree actually consumes. */
export function getShellMessages(messages: AbstractIntlMessages): AbstractIntlMessages {
  return {
    Brand: messages.Brand,
    Nav: messages.Nav,
    Common: messages.Common,
    Contacts: messages.Contacts,
    BuyingGuide: { navLabel: (messages.BuyingGuide as AbstractIntlMessages).navLabel },
  };
}

export function getCalculatorCommonMessages(messages: AbstractIntlMessages): AbstractIntlMessages {
  return {
    Nav: messages.Nav,
    Calculator: messages.Calculator,
    Countries: messages.Countries,
    Fees: messages.Fees,
    Errors: messages.Errors,
    Reasons: messages.Reasons,
    Assumptions: messages.Assumptions,
    FeeDisplay: messages.FeeDisplay,
    ResultStamp: messages.ResultStamp,
    CopyQuote: messages.CopyQuote,
  };
}

export function getCalculatorCountryMessages(
  messages: AbstractIntlMessages,
  country: string,
): AbstractIntlMessages {
  const policy = messages.CountryPolicies as AbstractIntlMessages;
  return {
    FeeMethods: { [country]: (messages.FeeMethods as AbstractIntlMessages)[country] },
    CountryPolicies: {
      title: policy.title,
      referenceHint: policy.referenceHint,
      source: policy.source,
      [country]: policy[country],
    },
  };
}
