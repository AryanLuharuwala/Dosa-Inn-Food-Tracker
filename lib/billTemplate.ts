export interface BillTemplate {
  header: {
    showLogo: boolean;
    logoUrl: string;
    restaurantNameSize: 'sm' | 'md' | 'lg' | 'xl';
    showTagline: boolean;
    taglineOverride: string;
    showDivider: boolean;
  };
  orderInfo: {
    showOrderId: boolean;
    showToken: boolean;
    showTable: boolean;
    showDateTime: boolean;
    showCustomerName: boolean;
    showCustomerPhone: boolean;
  };
  items: {
    fontSize: 'sm' | 'md' | 'lg';
    showPrices: boolean;
    showAddOns: boolean;
  };
  total: {
    fontSize: 'md' | 'lg' | 'xl';
    showItemCount: boolean;
    showPaymentMethod: boolean;
  };
  footer: {
    customMessage: string;
    showQrCode: boolean;
    upiId: string;       // UPI ID — a clean QR is generated from this at print/display time
    qrLabel: string;
    footerNote: string;
    /** Second QR, independent of the payment QR — links to this order's
     *  track-order page so the customer can scan their own bill. */
    trackOrderQr: boolean;
    /** Free-text line under the thank-you message — phone/Instagram/etc. */
    contactLine: string;
  };
  watermark: {
    enabled: boolean;
    text: string;
  };
}

export const DEFAULT_BILL_TEMPLATE: BillTemplate = {
  header: {
    showLogo: false,
    logoUrl: '',
    restaurantNameSize: 'xl',
    showTagline: true,
    taglineOverride: '',
    showDivider: true,
  },
  orderInfo: {
    showOrderId: true,
    showToken: true,
    showTable: true,
    showDateTime: true,
    showCustomerName: false,
    showCustomerPhone: true,
  },
  items: {
    fontSize: 'md',
    showPrices: true,
    showAddOns: true,
  },
  total: {
    fontSize: 'xl',
    showItemCount: true,
    showPaymentMethod: true,
  },
  footer: {
    customMessage: 'Thank you! Visit again!',
    showQrCode: true,
    upiId: 'gpay-11260917554@okbizaxis',
    qrLabel: 'Scan to pay via UPI',
    footerNote: '',
    trackOrderQr: false,
    contactLine: '',
  },
  watermark: {
    enabled: false,
    text: '',
  },
};
