-- Protect financial/stock invariants even when writes bypass DTO validation.
ALTER TABLE "Product" ADD CONSTRAINT "Product_priceCents_bounds" CHECK ("priceCents" BETWEEN 1 AND 100000);
ALTER TABLE "Inventory" ADD CONSTRAINT "Inventory_stock_bounds" CHECK ("stock" BETWEEN 0 AND 10000);
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_quantity_bounds" CHECK ("quantity" BETWEEN 1 AND 99);
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_quantity_bounds" CHECK ("quantity" BETWEEN 1 AND 99);
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_price_bounds" CHECK ("unitPriceCents" BETWEEN 1 AND 100000);
ALTER TABLE "Order" ADD CONSTRAINT "Order_total_positive" CHECK ("totalCents" > 0);
