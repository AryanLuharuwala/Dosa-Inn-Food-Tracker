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
    qrUrl: string;
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
    showQrCode: false,
    qrUrl: '',
    qrLabel: 'Scan to order online',
    footerNote: '',
  },
  watermark: {
    enabled: false,
    text: '',
  },
};
