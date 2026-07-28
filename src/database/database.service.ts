import { Injectable } from '@nestjs/common';
import { Role } from '../common/enums/role.enum';

@Injectable()
export class DatabaseService {
  users = [
    {
      id: 'u_1',
      fullName: 'Super Admin',
      email: 'admin@example.com',
      password: 'password123',
      role: Role.SUPER_ADMIN,
    },
  ];

  customers = [
    {
      id: 'c_1',
      fullName: 'Ada Wellness Ltd',
      email: 'ops@adawellness.com',
      phone: '+234800000001',
      subscriptionPlan: 'Premium Care',
      installedProducts: 2,
    },
  ];

  products = [
    { id: 'p_1', name: 'UltraPure Machine', sku: 'UPM-001', price: 2500, stock: 12 },
    { id: 'p_2', name: 'Carbon Filter', sku: 'FLT-002', price: 120, stock: 150 },
  ];

  orders = [
    {
      id: 'o_1',
      customerId: 'c_1',
      status: 'processing',
      total: 2620,
      items: [
        { productId: 'p_1', qty: 1 },
        { productId: 'p_2', qty: 1 },
      ],
      createdAt: new Date().toISOString(),
    },
  ];

  installations = [
    {
      id: 'i_1',
      customerId: 'c_1',
      productId: 'p_1',
      installationDate: '2026-03-01',
      nextServiceDate: '2026-06-01',
      nextFilterChangeDate: '2026-05-01',
    },
  ];

  serviceBookings = [
    {
      id: 'sb_1',
      customerId: 'c_1',
      preferredDate: '2026-04-20',
      status: 'pending',
      issue: 'Routine maintenance and inspection',
    },
  ];

  crmRecords = [
    {
      id: 'crm_1',
      customerId: 'c_1',
      type: 'complaint',
      channel: 'email',
      summary: 'Low pressure reported by customer',
      status: 'follow_up_required',
      createdAt: new Date().toISOString(),
    },
  ];
}
