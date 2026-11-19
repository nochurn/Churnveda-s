let razorpayLoadPromise: Promise<boolean> | null = null;

/**
 * Ensures the deferred Razorpay Checkout SDK is loaded before opening Checkout.
 */
export async function ensureRazorpaySdk(timeoutMs: number = 6000): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  if (typeof (window as any).Razorpay !== 'undefined') return true;

  if (!razorpayLoadPromise) {
    razorpayLoadPromise = new Promise<boolean>((resolve) => {
      const start = Date.now();
      const poll = () => {
        if (typeof (window as any).Razorpay !== 'undefined') {
          resolve(true);
          return;
        }
        if (Date.now() - start >= timeoutMs) {
          resolve(false);
          return;
        }
        setTimeout(poll, 100);
      };

      const existing = document.querySelector('script[src*="checkout.razorpay.com/v1/checkout.js"]');
      if (!existing) {
        const script = document.createElement('script');
        script.src = 'https://checkout.razorpay.com/v1/checkout.js';
        script.async = true;
        script.onload = () => resolve(typeof (window as any).Razorpay !== 'undefined');
        script.onerror = () => resolve(false);
        document.head.appendChild(script);
      } else {
        poll();
      }
    }).finally(() => {
      if (typeof (window as any).Razorpay === 'undefined') {
        razorpayLoadPromise = null;
      }
    });
  }

  return razorpayLoadPromise;
}
