import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/** 交易详情里补全的商品图。按 SKU 或标题缓存，避免每次都打商城订单接口。 */
@Entity({ name: 'pp_product_image', comment: '商品图片缓存' })
export class ProductImageEntity {
  /** sku 按货号匹配，title 按规范化标题匹配。 */
  @PrimaryColumn({ name: 'cache_kind', type: 'varchar', length: 16, comment: '匹配方式：sku 或 title' })
  cacheKind: string;

  @PrimaryColumn({ name: 'cache_key', type: 'varchar', length: 300, comment: 'SKU 或规范化后的商品标题' })
  cacheKey: string;

  @Column({ name: 'image_url', type: 'text', default: '', comment: '商品图片地址' })
  imageUrl: string;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz', comment: '更新时间' })
  updatedAt: Date;
}
