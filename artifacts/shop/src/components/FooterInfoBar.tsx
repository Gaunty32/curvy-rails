import { Link } from 'wouter';

export function FooterInfoBar() {
  return (
    <div className="bg-gray-100 py-8 border-t border-gray-200 mt-12">
      <div className="container mx-auto px-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 text-center md:text-left">
          <div className="flex items-start gap-4">
            <div className="text-4xl text-gray-300 font-light">1</div>
            <div>
              <h4 className="font-bold text-gray-800 mb-2">4 EASY WAYS TO ORDER</h4>
              <p className="text-sm text-gray-600">Online, by email, by phone or in store. We make ordering your workwear simple.</p>
            </div>
          </div>
          <div className="flex items-start gap-4">
            <div className="text-4xl text-gray-300 font-light">2</div>
            <div>
              <h4 className="font-bold text-gray-800 mb-2">UK & EUROPEAN DELIVERY</h4>
              <p className="text-sm text-gray-600">Fast and reliable delivery options across the UK and Europe. Standard UK delivery £8.50.</p>
            </div>
          </div>
          <div className="flex items-start gap-4">
            <div className="text-4xl text-gray-300 font-light">3</div>
            <div>
              <h4 className="font-bold text-gray-800 mb-2">FREE LOGO APPLICATION*</h4>
              <p className="text-sm text-gray-600">We offer free standard left breast logo application on all our garments.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
