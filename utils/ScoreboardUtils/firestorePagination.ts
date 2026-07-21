import { doc, getDoc, QueryConstraint, startAfter } from "firebase/firestore";
import { db } from "@/firebase";


export const resumeAfterLastDoc = async (
collectionName: string,
lastId?: string
): Promise<QueryConstraint | null> => {
if (!lastId) return null;


try {
const snap = await getDoc(doc(db, collectionName, lastId));
if (!snap.exists()) return null;
return startAfter(snap);
} catch {
return null;
}
};