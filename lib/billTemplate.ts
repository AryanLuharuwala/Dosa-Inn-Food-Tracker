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
    qrImageUrl: string;  // direct image URL shown as-is (e.g. /upi-qr.jpg)
    qrUrl: string;       // fallback: encode this URL into a generated QR
    qrLabel: string;
    footerNote: string;
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
    qrImageUrl: '/upi-qr.jpg',
    qrUrl: '',
    qrLabel: 'Scan to pay via UPI',
    footerNote: '',
  },
  watermark: {
    enabled: false,
    text: '',
  },
};
