import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProductImageEntity } from '../entities/product-image.entity';

type Cache = { bySku: Record<string, string>; byTitle: Record<string, string> };

/** 用订单号或发票号去商城订单接口补商品图，结果写入 pp_product_image。 */
@Injectable()
export class CartImagesService {
  constructor(
    @InjectRepository(ProductImageEntity)
    private readonly images: Repository<ProductImageEntity>,
  ) {}

  async enrich(input: {
    customField?: string;
    invoiceId?: string;
    items?: any[];
    lookupBase?: string;
    authHeader?: string;
  }) {
    const cache = await this.readCache();
    let dirty = false;
    let lineItems: any[] = [];
    let orderIdUsed = '';
    let orderSource = '';
    const ids = [input.customField, input.invoiceId].map((v) => String(v || '').trim()).filter(Boolean);
    for (const oid of ids) {
      const order = await this.fetchOrder(oid, input.lookupBase, input.authHeader);
      if (!order) continue;
      lineItems = this.lines(order);
      if (!lineItems.length) continue;
      orderIdUsed = oid;
      orderSource = 'order';
      for (const li of lineItems) {
        if (this.remember(cache, li.sku || li.variantId, li.title || li.productTitle, this.imageOf(li))) dirty = true;
      }
      break;
    }
    const enriched = (input.items || []).map((item, index) => {
      let imageUrl = '';
      let match: string | null = null;
      const fromOrder = this.matchLine(item, lineItems);
      if (fromOrder) {
        imageUrl = this.imageOf(fromOrder);
        match = 'order';
      }
      const sku = String(item?.item_code || '').trim();
      if (!imageUrl && sku && cache.bySku[sku]) {
        imageUrl = cache.bySku[sku];
        match = 'cache-sku';
      }
      const titleKey = this.norm(item?.item_name || item?.item_description);
      if (!imageUrl && titleKey && cache.byTitle[titleKey]) {
        imageUrl = cache.byTitle[titleKey];
        match = 'cache-title';
      }
      if (imageUrl && this.remember(cache, item?.item_code, item?.item_name || item?.item_description, imageUrl)) {
        dirty = true;
      }
      return {
        key: `${item?.item_code || ''}|${item?.item_name || ''}|${index}`,
        item_code: item?.item_code || '',
        item_name: item?.item_name || '',
        imageUrl: imageUrl || null,
        match,
      };
    });
    if (dirty) await this.persist(cache);
    return {
      orderId: orderIdUsed || null,
      source: orderSource || (enriched.some((x) => x.imageUrl) ? 'cache' : null),
      items: enriched,
    };
  }

  private norm(value: string) {
    return String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fff]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private imageOf(line: any) {
    return line?.imageUrl || line?.image_url || line?.image || line?.featuredImage || line?.productImage || '';
  }

  private lines(order: any) {
    const list = order?.allLineItems || order?.lineItems || [];
    return Array.isArray(list) ? list : [];
  }

  private matchLine(item: any, lineItems: any[]) {
    const code = String(item?.item_code || '').trim();
    if (code) {
      const hit = lineItems.find((li) => {
        const sku = String(li?.sku || '').trim();
        const variantId = li?.variantId != null ? String(li.variantId) : '';
        return sku === code || variantId === code || variantId.endsWith(`/${code}`);
      });
      if (hit && this.imageOf(hit)) return hit;
    }
    const name = this.norm(item?.item_name || item?.item_description);
    if (!name) return null;
    const exact = lineItems.find((li) => this.norm(li?.title || li?.productTitle) === name);
    if (exact && this.imageOf(exact)) return exact;
    return (
      lineItems.find((li) => {
        const t = this.norm(li?.title || li?.productTitle);
        return t && (t.includes(name) || name.includes(t)) && this.imageOf(li);
      }) || null
    );
  }

  private remember(cache: Cache, sku: string, title: string, imageUrl: string) {
    if (!imageUrl) return false;
    let changed = false;
    const skuKey = String(sku || '').trim();
    const titleKey = this.norm(title);
    if (skuKey && cache.bySku[skuKey] !== imageUrl) {
      cache.bySku[skuKey] = imageUrl;
      changed = true;
    }
    if (titleKey && cache.byTitle[titleKey] !== imageUrl) {
      cache.byTitle[titleKey] = imageUrl;
      changed = true;
    }
    return changed;
  }

  private async readCache(): Promise<Cache> {
    const rows = await this.images.find();
    const cache: Cache = { bySku: {}, byTitle: {} };
    for (const row of rows) {
      if (row.cacheKind === 'sku') cache.bySku[row.cacheKey] = row.imageUrl;
      if (row.cacheKind === 'title') cache.byTitle[row.cacheKey] = row.imageUrl;
    }
    return cache;
  }

  private async persist(cache: Cache) {
    const rows: ProductImageEntity[] = [];
    for (const [cacheKey, imageUrl] of Object.entries(cache.bySku)) {
      if (!cacheKey || !imageUrl || cacheKey.length > 300) continue;
      rows.push(this.images.create({ cacheKind: 'sku', cacheKey, imageUrl }));
    }
    for (const [cacheKey, imageUrl] of Object.entries(cache.byTitle)) {
      if (!cacheKey || !imageUrl || cacheKey.length > 300) continue;
      rows.push(this.images.create({ cacheKind: 'title', cacheKey, imageUrl }));
    }
    if (rows.length) await this.images.save(rows);
  }

  private unwrap(payload: any) {
    if (!payload || typeof payload !== 'object') return null;
    if (payload.order) return payload.order;
    if (payload.data?.order) return payload.data.order;
    if (payload.data?.lineItems || payload.data?.orderId) return payload.data;
    if (payload.lineItems || payload.orderId) return payload;
    return null;
  }

  private async fetchOrder(orderId: string, lookupBase?: string, authHeader?: string) {
    if (!lookupBase || !orderId) return null;
    const url = `${lookupBase.replace(/\/$/, '')}/${encodeURIComponent(orderId)}`;
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (authHeader) headers.Authorization = authHeader;
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
      if (!res.ok) return null;
      return this.unwrap(await res.json());
    } catch {
      return null;
    }
  }
}
