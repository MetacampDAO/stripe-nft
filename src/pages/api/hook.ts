import { Metaplex } from '@metaplex-foundation/js';
import { createCreateMetadataAccountV3Instruction, Creator, DataV2 } from '@metaplex-foundation/mpl-token-metadata';
import {
    createAssociatedTokenAccountInstruction,
    createInitializeMintInstruction,
    createMintToInstruction,
    getAssociatedTokenAddress,
    getMinimumBalanceForRentExemptMint,
    MINT_SIZE,
    TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { Connection, Keypair, PublicKey, sendAndConfirmTransaction, SystemProgram, Transaction } from '@solana/web3.js';
import base58 from 'bs58';
import { buffer } from 'micro';
import { NextApiRequest, NextApiResponse } from 'next';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
    // https://github.com/stripe/stripe-node#configuration
    apiVersion: '2022-08-01',
});

const webhookSecret: string = process.env.STRIPE_WEBHOOK_SECRET!;

// Stripe requires the raw body to construct the event.
export const config = {
    api: {
        bodyParser: false,
    },
};

const mintNftToBuyer = async (buyerPubkey: PublicKey) => {
    const connection = new Connection('https://api.devnet.solana.com');
    const lamports = await getMinimumBalanceForRentExemptMint(connection);
    const sellerDecodeKp = base58.decode(process.env.WALLET_SECRET!);
    const sellerU8IntKp = new Uint8Array(
        sellerDecodeKp.buffer,
        sellerDecodeKp.byteOffset,
        sellerDecodeKp.byteLength / Uint8Array.BYTES_PER_ELEMENT
    );
    const sellerKeypair = Keypair.fromSecretKey(sellerU8IntKp);
    const sellerPubkey = sellerKeypair.publicKey;
    const mintKeypair = Keypair.generate();
    const tokenATA = await getAssociatedTokenAddress(mintKeypair.publicKey, buyerPubkey);
    const metaplex = new Metaplex(connection);
    const metadataPDA = metaplex.nfts().pdas().metadata({ mint: mintKeypair.publicKey });

    const tokenMetadata = {
        name: 'SMB #128',
        symbol: 'SMB',
        uri: 'https://arweave.net/y4fS4LnfeWEaxq6z5qjeASaS6r9LEgMZnaTW-CI7sYM',
        sellerFeeBasisPoints: 0,
        creators: [
            {
                address: sellerPubkey,
                verified: true,
                share: 100,
            } as Creator,
        ],
        collection: null,
        uses: null,
    } as DataV2;

    const mintNftToBuyerTrx = new Transaction().add(
        SystemProgram.createAccount({
            fromPubkey: sellerPubkey,
            newAccountPubkey: mintKeypair.publicKey,
            space: MINT_SIZE,
            lamports: lamports,
            programId: TOKEN_PROGRAM_ID,
        }),
        createInitializeMintInstruction(mintKeypair.publicKey, 0, sellerPubkey, sellerPubkey, TOKEN_PROGRAM_ID),
        createAssociatedTokenAccountInstruction(sellerPubkey, tokenATA, buyerPubkey, mintKeypair.publicKey),
        createMintToInstruction(mintKeypair.publicKey, tokenATA, sellerPubkey, 1),
        createCreateMetadataAccountV3Instruction(
            {
                metadata: metadataPDA,
                mint: mintKeypair.publicKey,
                mintAuthority: sellerPubkey,
                payer: sellerPubkey,
                updateAuthority: sellerPubkey,
            },
            {
                createMetadataAccountArgsV3: {
                    data: tokenMetadata,
                    isMutable: true,
                    collectionDetails: null,
                },
            }
        )
    );
    return await sendAndConfirmTransaction(connection, mintNftToBuyerTrx, [sellerKeypair, mintKeypair]);
};

const webhookHandler = async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method === 'POST') {
        const buf = await buffer(req);
        const sig = req.headers['stripe-signature']!;
        let event: Stripe.Event;

        try {
            event = stripe.webhooks.constructEvent(buf.toString(), sig, webhookSecret);
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : 'Unknown error';
            // On error, log and return the error message.
            if (err! instanceof Error) console.log(err);
            console.log(`❌ Error message: ${errorMessage}`);
            // deepcode ignore XSS: <please specify a reason of ignoring this>
            res.status(400).send(`Webhook Error: ${errorMessage}`);
            return;
        }

        // Successfully constructed event.
        console.log('✅ Success:', event.id);

        switch (event.type) {
            case 'payment_intent.succeeded':
                const invoice = event.data.object as Stripe.Invoice;
                if (invoice.metadata) {
                    const buyerPubkeyStr = invoice.metadata.buyerPubkeyStr;
                    const buyerPubkey = new PublicKey(buyerPubkeyStr);
                    const txSig = await mintNftToBuyer(buyerPubkey);
                    console.log('txSig', txSig);
                }
                break;
            default:
                console.log(`Unhandled event type ${event.type}`);
        }
        res.json({ received: true });
    } else {
        res.setHeader('Allow', 'POST');
        res.status(405).end('Method Not Allowed');
    }
};

export default webhookHandler;
