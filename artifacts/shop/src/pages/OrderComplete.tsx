import { Link, useLocation } from 'wouter';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { CheckCircle } from 'lucide-react';

export default function OrderComplete() {
  const searchParams = new URLSearchParams(window.location.search);
  const orderId = searchParams.get('orderId');
  const orderNumber = orderId && /^\d+$/.test(orderId) ? `W${orderId}` : null;

  return (
    <div className="container mx-auto px-4 py-12">
      {/* 3-step Breadcrumb */}
      <div className="flex items-center justify-center gap-4 mb-16 text-sm sm:text-base md:text-xl font-bold">
        <span className="text-gray-400">① BASKET</span>
        <span className="text-gray-300">→</span>
        <span className="text-gray-400">② CHECKOUT DETAILS</span>
        <span className="text-gray-300">→</span>
        <span className="text-gray-900">③ ORDER COMPLETE</span>
      </div>

      <div className="max-w-2xl mx-auto text-center border-t-4 border-primary bg-gray-50 p-12 shadow-sm">
        <div className="flex justify-center mb-6">
          <CheckCircle className="w-20 h-20 text-green-500" />
        </div>
        <h1 className="text-3xl font-bold text-gray-900 mb-4">Thank You!</h1>
        <p className="text-xl text-gray-600 mb-8">Your order has been received.</p>
        
        {orderNumber && (
          <div className="bg-white p-6 border border-gray-200 mb-8 inline-block text-left mx-auto">
            <p className="text-gray-500 mb-1">Order Number:</p>
            <p className="font-bold text-lg text-primary">{orderNumber}</p>
          </div>
        )}

        <div>
          <Link href="/">
            <Button size="lg" className="rounded-none font-bold px-8">CONTINUE SHOPPING</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
