```python
"""
Mini POS Backend Service - A simple point-of-sale system with receipt management and cash balance calculation.
"""

import uuid
import json
from datetime import datetime
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass, field, asdict
from enum import Enum


class Currency(Enum):
    IRR = "IRR"  # Iranian Rial
    T = "T"      # Toman (1 T = 10 IRR)


@dataclass
class Product:
    """Represents a product in the inventory."""
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    name: str = ""
    price: float = 0.0
    quantity: int = 0
    category: str = "General"
    created_at: str = field(default_factory=lambda: datetime.now().isoformat())
    updated_at: str = field(default_factory=lambda: datetime.now().isoformat())


@dataclass
class ReceiptItem:
    """Represents an item in a receipt."""
    product_id: str
    product_name: str
    quantity: int
    unit_price: float
    total: float = 0.0

    def __post_init__(self):
        self.total = round(self.quantity * self.unit_price, 2)


@dataclass
class Receipt:
    """Represents a sales receipt."""
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    items: List[ReceiptItem] = field(default_factory=list)
    subtotal: float = 0.0
    discount: float = 0.0
    tax: float = 0.0
    total: float = 0.0
    payment_method: str = "cash"
    cash_received: float = 0.0
    change_due: float = 0.0
    created_at: str = field(default_factory=lambda: datetime.now().isoformat())
    status: str = "completed"

    def calculate_totals(self):
        """Calculate subtotal, discount, tax, and total."""
        self.subtotal = sum(item.total for item in self.items)
        if self.discount >= self.subtotal:
            self.discount = self.subtotal
        after_discount = self.subtotal - self.discount
        self.total = round(after_discount + (after_discount * self.tax / 100), 2)
        if self.payment_method == "cash":
            self.change_due = max(0.0, round(self.cash_received - self.total, 2))

    def validate(self) -> Tuple[bool, str]:
        """Validate receipt data."""
        if not self.items:
            return False, "Receipt must have at least one item"
        if any(item.quantity <= 0 for item in self.items):
            return False, "Item quantity must be positive"
        if any(item.unit_price <= 0 for item in self.items):
            return False, "Item price must be positive"
        if self.payment_method == "cash" and self.cash_received < self.total:
            return False, "Insufficient cash received"
        return True, "Valid"


class Inventory:
    """Manages product inventory."""

    def __init__(self):
        self._products: Dict[str, Product] = {}

    def add_product(self, product: Product) -> str:
        """Add a new product to inventory."""
        if product.id in self._products:
            raise ValueError(f"Product with ID {product.id} already exists")
        if product.quantity < 0:
            raise ValueError("Product quantity cannot be negative")
        self._products[product.id] = product
        return product.id

    def update_product(self, product_id: str, updates: dict) -> bool:
        """Update product attributes."""
        if product_id not in self._products:
            raise KeyError(f"Product {product_id} not found")
        product = self._products[product_id]
        for key, value in updates.items():
            if hasattr(product, key) and key not in ("id", "created_at"):
                if key == "quantity" and value < 0:
                    raise ValueError("Quantity cannot be negative")
                setattr(product, key, value)
        product.updated_at = datetime.now().isoformat()
        return True

    def get_product(self, product_id: str) -> Optional[Product]:
        """Get product by ID."""
        return self._products.get(product_id)

    def reduce_stock(self, product_id: str, quantity: int) -> bool:
        """Reduce stock for a product."""
        product = self._products.get(product_id)
        if not product:
            raise KeyError(f"Product {product_id} not found")
        if product.quantity < quantity:
            raise ValueError(f"Insufficient stock for {product.name}")
        product.quantity -= quantity
        product.updated_at = datetime.now().isoformat()
        return True

    def increase_stock(self, product_id: str, quantity: int) -> bool:
        """Increase stock for a product."""
        product = self._products.get(product_id)
        if not product:
            raise KeyError(f"Product {product_id} not found")
        product.quantity += quantity
        product.updated_at = datetime.now().isoformat()
        return True

    def search_products(self, query: str = "") -> List[Product]:
        """Search products by name or category."""
        if not query:
            return list(self._products.values())
        query_lower = query.lower()
        return [
            p for p in self._products.values()
            if query_lower in p.name.lower() or query_lower in p.category.lower()
        ]

    def get_low_stock_products(self, threshold: int = 10) -> List[Product]:
        """Get products with stock below threshold."""
        return [p for p in self._products.values() if p.quantity < threshold]


class CashRegister:
    """Manages cash balance and transactions."""

    def __init__(self, initial_balance: float = 0.0):
        self._balance = initial_balance
        self._transactions: List[dict] = []

    @property
    def balance(self) -> float:
        return round(self._balance, 2)

    def add_transaction(self, amount: float, description: str, transaction_type: str) -> float:
        """Record a cash transaction and return new balance."""
        if transaction_type == "sale":
            self._balance += amount
        elif transaction_type == "refund":
            if self._balance < amount:
                raise ValueError("Insufficient cash balance for refund")
            self._balance -= amount
        else:
            raise ValueError(f"Unknown transaction type: {transaction_type}")

        transaction = {
            "id": str(uuid.uuid4()),
            "amount": round(amount, 2),
            "type": transaction_type,
            "description": description,
            "balance_after": self.balance,
            "timestamp": datetime.now().isoformat()
        }
        self._transactions.append(transaction)
        return self.balance

    def get_transaction_history(self, limit: int = 50) -> List[dict]:
        """Get recent transaction history."""
        return self._transactions[-limit:]

    def reset_balance(self, new_balance: float = 0.0) -> float:
        """Reset cash balance to a specific amount."""
        old_balance = self.balance
        diff = new_balance - old_balance
        self._balance = new_balance
        self._transactions.append({
            "id": str(uuid.uuid4()),
            "amount": diff,
            "type": "adjustment",
            "description": f"Balance adjusted from {old_balance} to {new_balance}",
            "balance_after": self.balance,
            "timestamp": datetime.now().isoformat()
        })
        return self.balance


class MiniPOS:
    """Main Point of Sale system combining inventory, cash register, and receipt management."""

    def __init__(self, currency: Currency = Currency.IRR):
        self.currency = currency
        self.inventory = Inventory()
        self.cash_register = CashRegister()
        self._receipts: Dict[str, Receipt] = {}
        self._current_receipt: Optional[Receipt] = None

    def start_new_receipt(self) -> str:
        """Start a new receipt session."""
        self._current_receipt = Receipt()
        self._receipts[self._current_receipt.id] = self._current_receipt
        return self._current_receipt.id

    def add_item_to_receipt(self, product_id: str, quantity: int) -> bool:
        """Add item from inventory to the current receipt."""
        if not self._current_receipt:
            raise ValueError("No active receipt. Start a new receipt first.")

        product = self.inventory.get_product(product_id)
        if not product:
            raise KeyError(f"Product {product_id} not found in inventory")

        if product.quantity < quantity:
            raise ValueError(f"Insufficient stock. Available: {product.quantity}")

        # Check if item already exists in receipt
        existing_item = None
        for item in self._current_receipt.items:
            if item.product_id == product_id:
                existing_item = item
                break

        if existing_item:
            existing_item.quantity += quantity
            existing_item.total = round(existing_item.quantity * existing_item.unit_price, 2)
        else:
            item = ReceiptItem(
                product_id=product_id,
                product_name=product.name,
                quantity=quantity,
                unit_price=product.price
            )
            self._current_receipt.items.append(item)

        # Reserve stock (will be confirmed on finalize)
        self._current_receipt.calculate_totals()
        return True

    def remove_item_from_receipt(self, product_id: str) -> bool:
        """Remove an item from the current receipt."""
        if not self._current_receipt:
            raise ValueError("No active receipt")

        for item in self._current_receipt.items:
            if item.product_id == product_id:
                self._current_receipt.items.remove(item)
                self._current_receipt.calculate_totals()
                return True
        raise KeyError(f"Product {product_id} not in current receipt")

    def apply_discount(self, discount_amount: float) -> bool:
        """Apply discount to the current receipt."""
        if not self._current_receipt:
            raise ValueError("No active receipt")
        if discount_amount < 0:
            raise ValueError("Discount cannot be negative")
        self._current_receipt.discount = discount_amount
        self._current_receipt.calculate_totals()
        return True

    def apply_tax(self, tax_percentage: float) -> bool:
        """Apply tax percentage to the current receipt."""
        if not self._current_receipt:
            raise ValueError("No active receipt")
        if tax_percentage < 0:
            raise ValueError("Tax percentage cannot be negative")
        if tax_percentage > 100:
            raise ValueError("Tax percentage cannot exceed 100%")
        self._current_receipt.tax = tax_percentage
        self._current_receipt.calculate_totals()
        return True

    def finalize_receipt(self, cash_received: float = 0.0, payment_method: str = "cash") -> Receipt:
        """Finalize the current receipt and update inventory and cash register."""
        if not self._current_receipt:
            raise ValueError("No active receipt to finalize")

        receipt = self._current_receipt
        receipt.payment_method = payment_method
        receipt.cash_received = cash_received

        # Validate
        is_valid, msg = receipt.validate()
        if not is_valid:
            raise ValueError(f"Receipt validation failed: {msg}")

        # Deduct stock for each item
        for item in receipt.items:
            try:
                self.inventory.reduce_stock(item.product_id, item.quantity)
            except (KeyError, ValueError) as e:
                # Rollback previous deductions
                for prev_item in receipt.items:
                    if prev_item.product_id == item.product_id:
                        break
                    self.inventory.increase_stock(prev_item.product_id, prev_item.quantity)
                raise

        # Record cash transaction if cash payment
        if payment_method == "cash":
            self.cash_register.add_transaction(
                amount=receipt.total,
                description=f"Sale receipt #{receipt.id[:8]}",
                transaction_type="sale"
            )

        receipt.status = "completed"
        self._current_receipt = None
        return receipt

    def void_receipt(self, receipt_id: str) -> bool:
        """Void a completed receipt and reverse inventory changes."""
        receipt = self._receipts.get(receipt_id)
        if not receipt:
            raise KeyError(f"Receipt {receipt_id} not found")
        if receipt.status == "voided":
            raise ValueError("Receipt already voided")

        # Restore stock
        for item in receipt.items:
            self.inventory.increase_stock(item.product_id, item.quantity)

        # Handle cash refund if paid by cash
        if receipt.payment_method == "cash":
            self.cash_register.add_transaction(
                amount=receipt.total,
                description=f"Refund for receipt #{receipt_id[:8]}",
                transaction_type="refund"
            )

        receipt.status = "voided"
        return True

    def get_receipt(self, receipt_id: str) -> Optional[Receipt]:
        """Get receipt by ID."""
        return self._receipts.get(receipt_id)

    def get_daily_sales(self, date: Optional[str] = None) -> dict:
        """Get sales summary for a specific date (defaults to today)."""
        target_date = date or datetime.now().strftime("%Y-%m-%d")
        total_sales = 0.0
        transaction_count = 0
        items_sold = 0
        discounts_total = 0.0
        taxes_collected = 0.0

        for receipt in self._receipts.values():
            if receipt.created_at.startswith(target_date) and receipt.status == "completed":
                total_sales += receipt.total
                transaction_count += 1
                items_sold += sum(item.quantity for item in receipt.items)
                discounts_total += receipt.discount
                taxes_collected += receipt.total * (receipt.tax / 100)

        return {
            "date": target_date,
            "total_sales": round(total_sales, 2),
            "transaction_count": transaction_count,
            "items_sold": items_sold,
            "average_transaction": round(total_sales / transaction_count, 2) if transaction_count else 0.0,
            "discounts_total": round(discounts_total, 2),
            "taxes_collected": round(taxes_collected, 2),
            "currency": self.currency.value
        }

    def get_cash_balance(self) -> float:
        """Get current cash register balance."""
        return self.cash_register.balance

    def search_receipts(self, query: str = "") -> List[Receipt]:
        """Search receipts by ID or date."""
        if not query:
            return list(self._receipts.values())
        query_lower = query.lower()
        return [
            r for r in self._receipts.values()
            if query_lower in r.id.lower() or query_lower in r.created_at
        ]

    def to_dict(self) -> dict:
        """Serialize the system state to dictionary."""
        return {
            "inventory": [asdict(p) for p in self.inventory.search_products()],
            "cash_balance": self.cash_register.balance,
            "receipts_count": len(self._receipts),
            "currency": self.currency.value,
            "last_update": datetime.now().isoformat()
        }

    def generate_report(self) -> dict:
        """Generate comprehensive report."""
        return {
            "products_count": len(self.inventory._products),
            "low_stock_count": len(self.inventory.get_low_stock_products()),
            "cash_balance": self.cash_register.balance,
            "total_receipts": len(self._receipts),
            "completed_receipts": len([r for r in self._receipts.values() if r.status == "completed"]),
            "voided_receipts": len([r for r in self._receipts.values() if r.status == "voided"]),
            "today_sales": self.get_daily_sales(),
            "active_receipt": self._current_receipt is not None
        }


# Example usage and test
if __name__ == "__main__":
    # Initialize POS
    pos = MiniPOS(currency=Currency.T)

    # Add products
    p1 = Product(name="Coffee", price=15.0, quantity=50, category="Beverages")
    p2 = Product(name="Tea", price=10.0, quantity=100, category="Beverages")
    p3 = Product(name="Sandwich", price=45.0, quantity=30, category="Food")
    pos.inventory.add_product(p1)
    pos.inventory.add_product(p2)
    pos.inventory.add_product(p3)

    # Perform a sale
    receipt_id = pos.start_new_receipt()
    pos.add_item_to_receipt(p1.id, 2)  # 2 coffees
    pos.add_item_to_receipt(p2.id, 1)  # 1 tea
    pos.apply_tax(9)  # 9% tax
    finalized = pos.finalize_receipt(cash_received=100.0)

    print(f"Receipt {finalized.id[:8]} completed")
    print(f"Total: {finalized.total} {pos.currency.value}")
    print(f"Cash received: {finalized.cash_received} {pos.currency.value}")
    print(f"Change due: {finalized.change_due} {pos.currency.value}")
    print(f"Cash balance: {pos.get_cash_balance()} {pos.currency.value}")

    # Generate report
    report = pos.generate_report()
    print(f"\nDaily sales: {report['today_sales']['total_sales']} {pos.currency.value}")
    print(f"Transactions today: {report['today_sales']['transaction_count']}")
```