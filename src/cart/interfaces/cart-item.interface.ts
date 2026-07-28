export interface CartItem {
  productId: string;
  quantity: number;
  installedProductId?: string;
  type?: 'machine' | 'filter' | 'accessory' | 'service';
  variant?: {
    id?: string;
    label?: string;
    value?: string;
    imageUrl?: string;
  };
}
