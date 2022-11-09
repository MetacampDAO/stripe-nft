import { PublicKey } from '@solana/web3.js';
import { NextApiRequest, NextApiResponse } from 'next';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
    // https://github.com/stripe/stripe-node#configuration
    apiVersion: '2022-08-01',
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method === 'POST') {
        const buyerPubkeyStr: string = req.body.publicKey;
        try {
            const buyerPubkey = new PublicKey(buyerPubkeyStr);
            const price: Stripe.Price = await stripe.prices.retrieve('price_1M2I3HBPAJVUIFGVxPjK48Ns');
            const paymentMode: Stripe.Checkout.SessionCreateParams.Mode = 'payment';
            const params: Stripe.Checkout.SessionCreateParams = {
                payment_method_types: ['card'],
                line_items: [
                    {
                        price: price.id,
                        quantity: 1,
                    },
                ],
                mode: paymentMode,
                success_url: `${req.headers.origin}/success`,
                cancel_url: `${req.headers.origin}`,
                payment_intent_data: {
                    metadata: {
                        buyerPubkeyStr,
                    },
                },
            };
            const checkoutSession: Stripe.Checkout.Session = await stripe.checkout.sessions.create(params);

            res.status(200).json(checkoutSession);
        } catch (err) {
          console.log(err)
            res.status(500).end('Something Went Wrong');
        }
    } else {
        res.setHeader('Allow', 'POST');
        res.status(405).end('Method Not Allowed');
    }
}
